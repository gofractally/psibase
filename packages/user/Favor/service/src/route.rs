//! Sealed payment routes. The query service searches and seals. Execution
//! opens the envelope and never searches.
//!
//! Twelve slots are always present, including unused padding, so the blob
//! does not reveal how many hops were used. Each slot is keyed by the
//! account that must be the current debtor.
//!
//! Each slot also carries the amount that hop must draw, in the hop's asset
//! and after fees. Execution prices every hop live and rejects the payment if
//! any draw differs, so a replaced fee, FX rate or relay reserve fails instead
//! of filling at a worse price inside `min_return`.
//!
//! The key is objective state, so this keeps hops from the UI and plugin. It
//! is not secrecy from anyone who reads the key table or history.
use chacha20poly1305::{
    aead::{Aead, Payload},
    KeyInit, XChaCha20Poly1305, XNonce,
};
use hmac::{Hmac, Mac};
use psibase::AccountNumber;
use sha2::Sha256;

use crate::tables::PathHop;

pub const INVALID: &str = "payment unavailable; request a fresh preview";
pub const SLOTS: usize = 12;
/// Quote lifetime. Execution also rejects a stamp more than five minutes ahead.
pub const QUOTE_TTL: i64 = 60;
const SKEW: i64 = 300;
const PLAIN: usize = 32;
const SEALED: usize = 48;

type HmacSha = Hmac<Sha256>;

#[derive(Clone, Debug)]
pub struct RouteTerms {
    pub epoch: u64,
    pub payer: AccountNumber,
    pub payee: AccountNumber,
    pub from_asset: u16,
    pub to_asset: u16,
    pub amount_in: u64,
    pub amount_out: u64,
    pub expires_at: i64,
}

#[derive(Clone, Debug)]
pub struct OpenedRoute {
    pub terms: RouteTerms,
    pub hops: Vec<PathHop>,
    /// What each hop must draw, in that hop's asset, after fees. Same length
    /// as `hops`. `amounts[0]` is `terms.amount_in`.
    pub amounts: Vec<u64>,
}

fn hex_encode(bytes: &[u8]) -> String {
    const DIGITS: &[u8] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for &byte in bytes {
        out.push(DIGITS[(byte >> 4) as usize] as char);
        out.push(DIGITS[(byte & 15) as usize] as char);
    }
    out
}

fn hex_decode(value: &str) -> Result<Vec<u8>, &'static str> {
    if value.len() % 2 != 0 || value.len() > 4096 {
        return Err(INVALID);
    }
    fn digit(b: u8) -> Result<u8, &'static str> {
        match b {
            b'0'..=b'9' => Ok(b - b'0'),
            b'a'..=b'f' => Ok(b - b'a' + 10),
            _ => Err(INVALID),
        }
    }
    value
        .as_bytes()
        .chunks_exact(2)
        .map(|c| Ok(digit(c[0])? * 16 + digit(c[1])?))
        .collect()
}

fn context_mac_bytes(terms: &RouteTerms) -> [u8; 53] {
    let mut out = [0_u8; 53];
    out[0] = 1;
    out[1..9].copy_from_slice(&terms.epoch.to_le_bytes());
    out[9..17].copy_from_slice(&terms.payer.value.to_le_bytes());
    out[17..25].copy_from_slice(&terms.payee.value.to_le_bytes());
    out[25..27].copy_from_slice(&terms.from_asset.to_le_bytes());
    out[27..29].copy_from_slice(&terms.to_asset.to_le_bytes());
    out[29..37].copy_from_slice(&terms.amount_in.to_le_bytes());
    out[37..45].copy_from_slice(&terms.amount_out.to_le_bytes());
    out[45..].copy_from_slice(&(terms.expires_at as u64).to_le_bytes());
    out
}

fn parse_context(bytes: &[u8]) -> Result<RouteTerms, &'static str> {
    if bytes.len() != 53 || bytes[0] != 1 {
        return Err(INVALID);
    }
    Ok(RouteTerms {
        epoch: u64::from_le_bytes(bytes[1..9].try_into().unwrap()),
        payer: AccountNumber::new(u64::from_le_bytes(bytes[9..17].try_into().unwrap())),
        payee: AccountNumber::new(u64::from_le_bytes(bytes[17..25].try_into().unwrap())),
        from_asset: u16::from_le_bytes(bytes[25..27].try_into().unwrap()),
        to_asset: u16::from_le_bytes(bytes[27..29].try_into().unwrap()),
        amount_in: u64::from_le_bytes(bytes[29..37].try_into().unwrap()),
        amount_out: u64::from_le_bytes(bytes[37..45].try_into().unwrap()),
        expires_at: i64::from_le_bytes(bytes[45..53].try_into().unwrap()),
    })
}

fn slot_key(
    secret: &[u8],
    terms: &RouteTerms,
    current: AccountNumber,
    index: usize,
) -> Result<[u8; 32], &'static str> {
    if secret.len() != 32 {
        return Err(INVALID);
    }
    let mut mac = <HmacSha as Mac>::new_from_slice(secret).map_err(|_| INVALID)?;
    mac.update(b"psibase:banx:route:v1\0");
    mac.update(&context_mac_bytes(terms));
    mac.update(&current.value.to_le_bytes());
    mac.update(&[index as u8]);
    Ok(mac.finalize().into_bytes().into())
}

fn slot_nonce(base: &[u8; 24], index: usize) -> [u8; 24] {
    let mut n = *base;
    n[23] ^= index as u8;
    n
}

fn outer_mac(
    secret: &[u8],
    terms: &RouteTerms,
    nonce: &[u8],
    layers: &[[u8; SEALED]],
) -> Result<[u8; 32], &'static str> {
    let mut mac = <HmacSha as Mac>::new_from_slice(secret).map_err(|_| INVALID)?;
    mac.update(b"psibase:banx:envelope:v1\0");
    mac.update(&context_mac_bytes(terms));
    mac.update(nonce);
    for layer in layers {
        mac.update(layer);
    }
    Ok(mac.finalize().into_bytes().into())
}

/// `amounts[i]` is what hop `i` draws. `random` is 24 bytes of nonce plus
/// 12 * 48 bytes of padding.
pub fn seal(
    secret: &[u8],
    terms: RouteTerms,
    hops: &[PathHop],
    amounts: &[u64],
    random: &[u8; 24 + SLOTS * SEALED],
) -> Result<String, &'static str> {
    if hops.is_empty()
        || hops.len() > SLOTS
        || hops.len() != amounts.len()
        || amounts[0] != terms.amount_in
        || secret.len() != 32
    {
        return Err(INVALID);
    }
    let nonce: [u8; 24] = random[..24].try_into().unwrap();
    let mut layers = [[0_u8; SEALED]; SLOTS];
    let mut current = terms.payer;
    for (index, hop) in hops.iter().enumerate() {
        let mut plain = [0_u8; PLAIN];
        plain[..8].copy_from_slice(&hop.account.value.to_le_bytes());
        plain[8..10].copy_from_slice(&hop.asset_id.to_le_bytes());
        plain[10] = u8::from(index + 1 == hops.len());
        plain[11..19].copy_from_slice(&amounts[index].to_le_bytes());
        plain[19..].copy_from_slice(&random[24 + index * SEALED..24 + index * SEALED + 13]);
        let key = slot_key(secret, &terms, current, index)?;
        let n = slot_nonce(&nonce, index);
        let cipher = XChaCha20Poly1305::new_from_slice(&key).map_err(|_| INVALID)?;
        let sealed = cipher
            .encrypt(
                XNonce::from_slice(&n),
                Payload {
                    msg: &plain,
                    aad: b"banx-route-hop-v1",
                },
            )
            .map_err(|_| INVALID)?;
        layers[index].copy_from_slice(&sealed);
        current = hop.account;
    }
    for index in hops.len()..SLOTS {
        layers[index].copy_from_slice(&random[24 + index * SEALED..24 + (index + 1) * SEALED]);
    }
    let tag = outer_mac(secret, &terms, &nonce, &layers)?;
    let mut blob = Vec::with_capacity(53 + 24 + SLOTS * SEALED + 32);
    blob.extend_from_slice(&context_mac_bytes(&terms));
    blob.extend_from_slice(&nonce);
    for layer in &layers {
        blob.extend_from_slice(layer);
    }
    blob.extend_from_slice(&tag);
    Ok(hex_encode(&blob))
}

pub fn open(secret: &[u8], encoded: &str, now: i64) -> Result<OpenedRoute, &'static str> {
    let blob = hex_decode(encoded)?;
    let expect = 53 + 24 + SLOTS * SEALED + 32;
    if blob.len() != expect || secret.len() != 32 {
        return Err(INVALID);
    }
    let terms = parse_context(&blob[..53])?;
    if terms.expires_at < now || terms.expires_at > now + SKEW {
        return Err(INVALID);
    }
    let nonce: [u8; 24] = blob[53..77].try_into().unwrap();
    let mut layers = [[0_u8; SEALED]; SLOTS];
    for (index, layer) in layers.iter_mut().enumerate() {
        let start = 77 + index * SEALED;
        layer.copy_from_slice(&blob[start..start + SEALED]);
    }
    let tag: [u8; 32] = blob[blob.len() - 32..].try_into().unwrap();
    let expect_tag = outer_mac(secret, &terms, &nonce, &layers)?;
    if tag != expect_tag {
        return Err(INVALID);
    }
    let mut hops = Vec::new();
    let mut amounts = Vec::new();
    let mut current = terms.payer;
    for index in 0..SLOTS {
        let key = slot_key(secret, &terms, current, index)?;
        let n = slot_nonce(&nonce, index);
        let cipher = XChaCha20Poly1305::new_from_slice(&key).map_err(|_| INVALID)?;
        let plain = cipher
            .decrypt(
                XNonce::from_slice(&n),
                Payload {
                    msg: &layers[index],
                    aad: b"banx-route-hop-v1",
                },
            )
            .map_err(|_| INVALID)?;
        if plain.len() != PLAIN || plain[10] > 1 {
            return Err(INVALID);
        }
        let hop = PathHop {
            account: AccountNumber::new(u64::from_le_bytes(plain[..8].try_into().unwrap())),
            asset_id: u16::from_le_bytes(plain[8..10].try_into().unwrap()),
        };
        let end = plain[10] != 0;
        hops.push(hop);
        amounts.push(u64::from_le_bytes(plain[11..19].try_into().unwrap()));
        if end {
            if hop.account != terms.payee || hop.asset_id != terms.to_asset {
                return Err(INVALID);
            }
            if hops[0].asset_id != terms.from_asset || amounts[0] != terms.amount_in {
                return Err(INVALID);
            }
            return Ok(OpenedRoute {
                terms,
                hops,
                amounts,
            });
        }
        current = hop.account;
    }
    Err(INVALID)
}

#[cfg(test)]
mod tests {
    use super::*;

    const KEY: [u8; 32] = [42; 32];
    const NOW: i64 = 1_000;

    fn acct(n: u64) -> AccountNumber {
        AccountNumber::new(n)
    }

    fn hop(account: u64, asset_id: u16) -> PathHop {
        PathHop {
            account: acct(account),
            asset_id,
        }
    }

    fn terms() -> RouteTerms {
        RouteTerms {
            epoch: 1,
            payer: acct(1),
            payee: acct(3),
            from_asset: 7,
            to_asset: 7,
            amount_in: 101,
            amount_out: 100,
            expires_at: NOW + QUOTE_TTL,
        }
    }

    fn random(fill: u8) -> [u8; 24 + SLOTS * SEALED] {
        [fill; 24 + SLOTS * SEALED]
    }

    fn two_hops(fill: u8) -> String {
        seal(
            &KEY,
            terms(),
            &[hop(2, 7), hop(3, 7)],
            &[101, 100],
            &random(fill),
        )
        .unwrap()
    }

    #[test]
    fn roundtrip_returns_the_hops_amounts_and_terms() {
        let opened = open(&KEY, &two_hops(9), NOW).unwrap();
        assert_eq!(opened.hops.len(), 2);
        assert_eq!(opened.hops[0].account, acct(2));
        assert_eq!(opened.hops[1].account, acct(3));
        assert_eq!(opened.amounts, vec![101, 100]);
        assert_eq!(opened.terms.payer, acct(1));
        assert_eq!(opened.terms.amount_in, 101);
        assert_eq!(opened.terms.amount_out, 100);
    }

    #[test]
    fn blob_length_does_not_show_the_hop_count() {
        let one = seal(
            &KEY,
            RouteTerms {
                payee: acct(2),
                amount_in: 100,
                ..terms()
            },
            &[hop(2, 7)],
            &[100],
            &random(5),
        )
        .unwrap();
        let three = seal(
            &KEY,
            terms(),
            &[hop(2, 7), hop(4, 7), hop(3, 7)],
            &[101, 100, 100],
            &random(6),
        )
        .unwrap();
        assert_eq!(one.len(), three.len());
        assert_eq!(one.len(), two_hops(1).len());
    }

    #[test]
    fn a_wrong_key_does_not_open() {
        assert!(open(&[43; 32], &two_hops(9), NOW).is_err());
    }

    #[test]
    fn any_flipped_byte_is_rejected() {
        let good = two_hops(9);
        for at in [0, 20, 60, 100, good.len() / 2, good.len() - 2] {
            let mut bytes = good.clone().into_bytes();
            bytes[at] = if bytes[at] == b'0' { b'1' } else { b'0' };
            let bad = String::from_utf8(bytes).unwrap();
            assert!(open(&KEY, &bad, NOW).is_err(), "byte {at} was not covered");
        }
    }

    #[test]
    fn padding_slots_are_covered_by_the_tag() {
        let good = two_hops(9);
        // Slot 11 is unused padding, just before the 32 byte tag.
        let pad = good.len() - 64 - 4;
        let mut bytes = good.into_bytes();
        bytes[pad] = if bytes[pad] == b'0' { b'1' } else { b'0' };
        assert!(open(&KEY, &String::from_utf8(bytes).unwrap(), NOW).is_err());
    }

    #[test]
    fn expiry_window_is_enforced() {
        let route = two_hops(9);
        assert!(open(&KEY, &route, NOW).is_ok());
        assert!(open(&KEY, &route, NOW + QUOTE_TTL).is_ok());
        assert!(open(&KEY, &route, NOW + QUOTE_TTL + 1).is_err());
        // A stamp far in the future is rejected even though it is not expired.
        let far = seal(
            &KEY,
            RouteTerms {
                expires_at: NOW + 10_000,
                ..terms()
            },
            &[hop(2, 7), hop(3, 7)],
            &[101, 100],
            &random(9),
        )
        .unwrap();
        assert!(open(&KEY, &far, NOW).is_err());
    }

    #[test]
    fn a_route_must_end_at_the_payee_in_the_to_asset() {
        let wrong_payee = seal(
            &KEY,
            terms(),
            &[hop(2, 7), hop(4, 7)],
            &[101, 100],
            &random(9),
        )
        .unwrap();
        assert!(open(&KEY, &wrong_payee, NOW).is_err());
        let wrong_asset = seal(
            &KEY,
            terms(),
            &[hop(2, 7), hop(3, 8)],
            &[101, 100],
            &random(9),
        )
        .unwrap();
        assert!(open(&KEY, &wrong_asset, NOW).is_err());
    }

    #[test]
    fn the_first_hop_amount_must_be_the_quoted_send() {
        // Sealing refuses a route whose first hop is not the quoted draw.
        assert!(seal(
            &KEY,
            terms(),
            &[hop(2, 7), hop(3, 7)],
            &[99, 100],
            &random(9),
        )
        .is_err());
    }

    #[test]
    fn hop_amounts_are_authenticated() {
        // Two routes that differ only in the second hop amount must not
        // share a tag, or one could be swapped for the other.
        let a = two_hops(9);
        let b = seal(
            &KEY,
            terms(),
            &[hop(2, 7), hop(3, 7)],
            &[101, 99],
            &random(9),
        )
        .unwrap();
        assert_ne!(a, b);
        assert_eq!(open(&KEY, &b, NOW).unwrap().amounts, vec![101, 99]);
        // Splice the second slot of `b` into `a`: the outer tag must fail.
        let slot = |s: &str, i: usize| {
            s[(53 + 24 + i * SEALED) * 2..(53 + 24 + (i + 1) * SEALED) * 2].to_string()
        };
        let spliced = a.replacen(&slot(&a, 1), &slot(&b, 1), 1);
        assert_ne!(spliced, a);
        assert!(open(&KEY, &spliced, NOW).is_err());
    }

    #[test]
    fn malformed_input_is_rejected() {
        assert!(open(&KEY, "", NOW).is_err());
        assert!(open(&KEY, "zz", NOW).is_err());
        assert!(open(&KEY, &"a".repeat(5000), NOW).is_err());
        assert!(seal(&KEY, terms(), &[], &[], &random(1)).is_err());
        assert!(seal(&KEY, terms(), &[hop(3, 7)], &[], &random(1)).is_err());
        assert!(seal(&[1; 31], terms(), &[hop(3, 7)], &[101], &random(1)).is_err());
    }
}
