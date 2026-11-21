//! Self-contained, fixed-seven-slot route envelopes. The objective service key
//! is never exported by the app. No query-local state is needed during replay.
use chacha20poly1305::{
    aead::{Aead, Payload},
    KeyInit, XChaCha20Poly1305, XNonce,
};
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const INVALID: &str = "Payment unavailable; request a fresh preview";
pub const SLOTS: usize = 7;
pub const MAX_ENVELOPE: usize = 4096;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Context {
    pub version: u8,
    pub epoch: u64,
    pub payer: String,
    pub payee: String,
    pub symbol: String,
    pub amount: u64,
    pub total: u64,
    pub expires_at: i64,
    pub reference: String,
    pub request: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Envelope {
    pub context: Context,
    pub nonce: String,
    pub layers: Vec<String>,
    pub tag: String,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Hop {
    pub line: u64,
    pub amount: u64,
    pub revision: u64,
    pub end: bool,
}

pub fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for &byte in bytes {
        out.push(DIGITS[(byte >> 4) as usize] as char);
        out.push(DIGITS[(byte & 15) as usize] as char);
    }
    out
}
pub fn unhex(value: &str) -> Result<Vec<u8>, &'static str> {
    if value.len() % 2 != 0 || value.len() > MAX_ENVELOPE {
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
pub fn hash_secret(secret: &str) -> Result<String, &'static str> {
    let bytes = unhex(secret)?;
    if bytes.len() != 32 {
        return Err(INVALID);
    }
    Ok(hex(&Sha256::digest(&bytes)))
}
fn key(
    secret: &[u8],
    context: &Context,
    current: &str,
    index: usize,
) -> Result<[u8; 32], &'static str> {
    if secret.len() != 32 {
        return Err(INVALID);
    }
    let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(secret).map_err(|_| INVALID)?;
    mac.update(b"psibase:favor:route:v1\0");
    mac.update(&serde_json::to_vec(context).map_err(|_| INVALID)?);
    mac.update(&[0]);
    mac.update(current.as_bytes());
    mac.update(&[index as u8]);
    Ok(mac.finalize().into_bytes().into())
}
fn nonce(base: &[u8], index: usize) -> Result<[u8; 24], &'static str> {
    let mut n: [u8; 24] = base.try_into().map_err(|_| INVALID)?;
    n[23] ^= index as u8;
    Ok(n)
}
impl Envelope {
    /// `random` comes from getRandom in a subjective query, never execution.
    pub fn seal(
        secret: &[u8],
        context: Context,
        hops: &[(String, Hop)],
        random: &[u8; 360],
    ) -> Result<String, &'static str> {
        if hops.is_empty() || hops.len() > SLOTS || context.version != 1 {
            return Err(INVALID);
        }
        let mut envelope = Self {
            context,
            nonce: hex(&random[..24]),
            layers: Vec::with_capacity(SLOTS),
            tag: String::new(),
        };
        for index in 0..SLOTS {
            if let Some((current, hop)) = hops.get(index) {
                let mut bytes = [0_u8; 32];
                bytes[..8].copy_from_slice(&hop.line.to_le_bytes());
                bytes[8..16].copy_from_slice(&hop.amount.to_le_bytes());
                bytes[16..24].copy_from_slice(&hop.revision.to_le_bytes());
                bytes[24] = u8::from(hop.end);
                // Remaining bytes are random padding, not route metadata.
                bytes[25..].copy_from_slice(&random[24 + index * 48..31 + index * 48]);
                let k = key(secret, &envelope.context, current, index)?;
                let n = nonce(&random[..24], index)?;
                let cipher = XChaCha20Poly1305::new_from_slice(&k).map_err(|_| INVALID)?;
                let sealed = cipher
                    .encrypt(
                        XNonce::from_slice(&n),
                        Payload {
                            msg: &bytes,
                            aad: b"favor-route-hop-v1",
                        },
                    )
                    .map_err(|_| INVALID)?;
                envelope.layers.push(hex(&sealed));
            } else {
                envelope
                    .layers
                    .push(hex(&random[24 + index * 48..72 + index * 48]));
            }
        }
        envelope.tag = hex(&envelope.mac(secret)?.finalize().into_bytes());
        let encoded = serde_json::to_string(&envelope).map_err(|_| INVALID)?;
        if encoded.len() > MAX_ENVELOPE {
            return Err(INVALID);
        }
        Ok(encoded)
    }
    pub fn parse(encoded: &str) -> Result<Self, &'static str> {
        if encoded.len() > MAX_ENVELOPE {
            return Err(INVALID);
        }
        let result: Self = serde_json::from_str(encoded).map_err(|_| INVALID)?;
        if result.context.version != 1
            || result.layers.len() != SLOTS
            || result.nonce.len() != 48
            || result.tag.len() != 64
            || result.layers.iter().any(|s| s.len() != 96)
        {
            return Err(INVALID);
        }
        // Reject malformed unused padding too; it must have the same format.
        unhex(&result.nonce)?;
        for layer in &result.layers {
            unhex(layer)?;
        }
        Ok(result)
    }
    fn mac(&self, secret: &[u8]) -> Result<Hmac<Sha256>, &'static str> {
        if secret.len() != 32 {
            return Err(INVALID);
        }
        let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(secret).map_err(|_| INVALID)?;
        mac.update(b"psibase:favor:envelope:v1\0");
        mac.update(
            &serde_json::to_vec(&(&self.context, &self.nonce, &self.layers))
                .map_err(|_| INVALID)?,
        );
        Ok(mac)
    }
    pub fn authenticate(&self, secret: &[u8]) -> Result<(), &'static str> {
        self.mac(secret)?
            .verify_slice(&unhex(&self.tag)?)
            .map_err(|_| INVALID)
    }
    pub fn open(&self, secret: &[u8], current: &str, index: usize) -> Result<Hop, &'static str> {
        let k = key(secret, &self.context, current, index)?;
        let n = nonce(&unhex(&self.nonce)?, index)?;
        let cipher = XChaCha20Poly1305::new_from_slice(&k).map_err(|_| INVALID)?;
        let bytes = cipher
            .decrypt(
                XNonce::from_slice(&n),
                Payload {
                    msg: &unhex(self.layers.get(index).ok_or(INVALID)?)?,
                    aad: b"favor-route-hop-v1",
                },
            )
            .map_err(|_| INVALID)?;
        if bytes.len() != 32 || bytes[24] > 1 {
            return Err(INVALID);
        }
        Ok(Hop {
            line: u64::from_le_bytes(bytes[..8].try_into().unwrap()),
            amount: u64::from_le_bytes(bytes[8..16].try_into().unwrap()),
            revision: u64::from_le_bytes(bytes[16..24].try_into().unwrap()),
            end: bytes[24] != 0,
        })
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn context() -> Context {
        Context {
            version: 1,
            epoch: 1,
            payer: "alice".into(),
            payee: "carol".into(),
            symbol: "USD".into(),
            amount: 100,
            total: 101,
            expires_at: 123,
            reference: "unique-reference".into(),
            request: None,
        }
    }
    fn sample() -> String {
        Envelope::seal(
            &[42; 32],
            context(),
            &[
                (
                    "alice".into(),
                    Hop {
                        line: 20,
                        amount: 101,
                        revision: 1,
                        end: false,
                    },
                ),
                (
                    "bob".into(),
                    Hop {
                        line: 21,
                        amount: 100,
                        revision: 2,
                        end: true,
                    },
                ),
            ],
            &[17; 360],
        )
        .unwrap()
    }
    #[test]
    fn roundtrip_and_resolution() {
        let route = Envelope::parse(&sample()).unwrap();
        route.authenticate(&[42; 32]).unwrap();
        assert_eq!(route.open(&[42; 32], "bob", 1).unwrap().line, 21);
        assert!(route.open(&[42; 32], "alice", 1).is_err());
        assert!(route.open(&[43; 32], "bob", 1).is_err());
    }
    #[test]
    fn all_public_fields_authenticated() {
        let e = Envelope::parse(&sample()).unwrap();
        let mut variants = vec![];
        macro_rules! change {
            ($field:ident,$value:expr) => {{
                let mut m = e.clone();
                m.context.$field = $value;
                variants.push(m);
            }};
        }
        change!(payer, "mallory".into());
        change!(payee, "mallory".into());
        change!(symbol, "BTC".into());
        change!(amount, 99);
        change!(total, 99);
        change!(expires_at, 124);
        change!(reference, "reused-ref".into());
        change!(epoch, 2);
        change!(request, Some("x".into()));
        for m in variants {
            assert!(m.open(&[42; 32], "alice", 0).is_err());
        }
    }
    #[test]
    fn ciphertext_and_layer_order_authenticated() {
        let mut e = Envelope::parse(&sample()).unwrap();
        e.layers.swap(0, 1);
        assert!(e.open(&[42; 32], "alice", 0).is_err());
        let mut e = Envelope::parse(&sample()).unwrap();
        e.layers[0].replace_range(0..2, "ff");
        assert!(e.open(&[42; 32], "alice", 0).is_err());
    }
    #[test]
    fn route_length_is_padded() {
        let one = Envelope::seal(
            &[42; 32],
            context(),
            &[(
                "alice".into(),
                Hop {
                    line: 20,
                    amount: 101,
                    revision: 1,
                    end: true,
                },
            )],
            &[18; 360],
        )
        .unwrap();
        assert_eq!(one.len(), sample().len());
        assert_eq!(Envelope::parse(&one).unwrap().layers.len(), 7);
        assert_ne!(one, sample());
    }
    #[test]
    fn unused_padding_is_authenticated() {
        let mut e = Envelope::parse(&sample()).unwrap();
        e.layers[6].replace_range(0..2, "ff");
        assert!(e.authenticate(&[42; 32]).is_err());
    }
    #[test]
    fn malformed_input_and_oversize_rejected() {
        assert!(Envelope::parse(&"x".repeat(5000)).is_err());
        assert!(Envelope::parse("{}").is_err());
        assert!(unhex("0g").is_err());
        assert!(unhex("a").is_err());
    }
}
