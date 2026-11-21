//! Deterministic EIP-712 authorization and exact vault event decoding.
use ethrelay_core::{self as eth, bytes, ensure, keccak, Hash, Result};
use serde::{Deserialize, Serialize};
pub fn word(n: u64) -> Hash {
    let mut r = [0; 32];
    r[24..].copy_from_slice(&n.to_be_bytes());
    r
}
pub fn address(s: &str) -> Result<String> {
    let a = bytes::<20>(s)?;
    ensure(a != [0; 20], "Zero Ethereum recipient")?;
    Ok(eth::hex(a))
}
pub fn public_address(public: &str) -> Result<String> {
    let p = secp256k1::PublicKey::from_slice(&hex::decode(public).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    Ok(eth::hex(&keccak(&p.serialize_uncompressed()[1..])[12..]))
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Payment {
    pub request: u64,
    pub address: String,
    pub amount: u64,
}
pub fn payments_hash(payments: &[Payment]) -> Result<Hash> {
    ensure(
        !payments.is_empty() && payments.len() <= 32,
        "ETH batch payment limit",
    )?;
    let mut data = vec![];
    for p in payments {
        ensure(p.amount > 0, "Empty ETH payment")?;
        data.extend_from_slice(&bytes::<20>(&address(&p.address)?)?);
        data.extend_from_slice(&p.amount.to_be_bytes());
    }
    Ok(keccak(&data))
}
pub fn digest(
    chain: u64,
    vault: &str,
    deployment: &str,
    nonce: u64,
    payments: &[Payment],
) -> Result<Hash> {
    let mut data = vec![];
    data.extend_from_slice(&keccak(b"EIP712Domain(string name,string version,uint256 chainId,address verifyingContract,bytes32 salt)"));
    data.extend_from_slice(&keccak(b"PsibaseETHBridge"));
    data.extend_from_slice(&keccak(b"1"));
    data.extend_from_slice(&word(chain));
    let mut contract = [0; 32];
    contract[12..].copy_from_slice(&bytes::<20>(vault)?);
    data.extend_from_slice(&contract);
    data.extend_from_slice(&bytes::<32>(deployment)?);
    let domain = keccak(&data);
    let mut body = keccak(b"Batch(uint256 nonce,bytes32 paymentsHash)").to_vec();
    body.extend_from_slice(&word(nonce));
    body.extend_from_slice(&payments_hash(payments)?);
    let mut signed = vec![0x19, 0x01];
    signed.extend_from_slice(&domain);
    signed.extend_from_slice(&keccak(&body));
    Ok(keccak(&signed))
}
pub fn recoverable(public: &str, hash: &str, signature: &str) -> Result<String> {
    use secp256k1::{
        ecdsa::{RecoverableSignature, RecoveryId, Signature},
        Message, PublicKey, Secp256k1,
    };
    let public = PublicKey::from_slice(&hex::decode(public).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    let raw = bytes::<64>(signature)?;
    let sig = Signature::from_compact(&raw).map_err(|e| e.to_string())?;
    let mut normalized = sig;
    normalized.normalize_s();
    ensure(normalized == sig, "High-S signature")?;
    let hash = Message::from_digest(bytes::<32>(hash)?);
    let secp = Secp256k1::verification_only();
    secp.verify_ecdsa(&hash, &sig, &public)
        .map_err(|e| e.to_string())?;
    for v in 0..2 {
        let id = RecoveryId::from_i32(v).unwrap();
        let recoverable =
            RecoverableSignature::from_compact(&raw, id).map_err(|e| e.to_string())?;
        if secp.recover_ecdsa(&hash, &recoverable).ok() == Some(public) {
            let mut encoded = raw.to_vec();
            encoded.push(27 + v as u8);
            return Ok(eth::hex(encoded));
        }
    }
    Err("Unrepresentable Ethereum recovery ID".into())
}
fn words<'a>(
    fact: &'a eth::ReceiptFact,
    vault: &str,
    event: &str,
    count: usize,
) -> Result<Vec<Hash>> {
    ensure(
        fact.address == address(vault)? && fact.topics == vec![eth::hex(keccak(event.as_bytes()))],
        "Wrong vault event",
    )?;
    let data = hex::decode(&fact.data).map_err(|e| e.to_string())?;
    ensure(data.len() == count * 32, "Vault event data length")?;
    Ok(data
        .chunks_exact(32)
        .map(|d| d.try_into().unwrap())
        .collect())
}
fn small(w: Hash) -> Result<u64> {
    ensure(w[..24] == [0; 24], "Vault integer overflow")?;
    Ok(u64::from_be_bytes(w[24..].try_into().unwrap()))
}
pub fn deposit(fact: &eth::ReceiptFact, vault: &str) -> Result<(u64, u64, u64)> {
    let w = words(fact, vault, "Deposit(uint64,uint64,uint64)", 3)?;
    let r = (small(w[0])?, small(w[1])?, small(w[2])?);
    ensure(r.0 > 0 && r.1 > 0 && r.2 > 0, "Invalid ETH deposit")?;
    Ok(r)
}
pub fn completed(fact: &eth::ReceiptFact, vault: &str) -> Result<(u64, String, u64)> {
    let w = words(fact, vault, "BatchExecuted(uint256,bytes32,uint64)", 3)?;
    Ok((small(w[0])?, eth::hex(w[1]), small(w[2])?))
}
pub fn configured(fact: &eth::ReceiptFact, vault: &str) -> Result<(String, u64, Vec<String>)> {
    let w = words(
        fact,
        vault,
        "Configured(bytes32,uint256,address,address,address)",
        5,
    )?;
    let mut keys = vec![];
    for k in &w[2..] {
        ensure(k[..12] == [0; 12], "Vault signer address padding")?;
        keys.push(address(&eth::hex(&k[12..]))?);
    }
    Ok((eth::hex(w[0]), small(w[1])?, keys))
}
pub fn split(value: u64, fee_bps: u16, publisher_bps: u16) -> Result<(u64, u64, u64)> {
    ensure(
        fee_bps <= 100 && publisher_bps <= 10000,
        "ETH deposit fee policy",
    )?;
    let fee = (u128::from(value) * u128::from(fee_bps) / 10000) as u64;
    let bounty = (u128::from(fee) * u128::from(publisher_bps) / 10000) as u64;
    Ok((value - fee, fee - bounty, bounty))
}
/// ABI encoding of execute(uint256,address[],uint64[],bytes[]).
pub fn calldata(nonce: u64, payments: &[Payment], signatures: &[String]) -> Result<String> {
    ensure(signatures.len() == 2, "Two signatures required")?;
    let _ = payments_hash(payments)?;
    let mut addresses = word(payments.len() as u64).to_vec();
    let mut amounts = word(payments.len() as u64).to_vec();
    for p in payments {
        let mut a = [0; 32];
        a[12..].copy_from_slice(&bytes::<20>(&p.address)?);
        addresses.extend_from_slice(&a);
        amounts.extend_from_slice(&word(p.amount));
    }
    let mut sigs = word(2).to_vec();
    sigs.extend_from_slice(&word(64));
    sigs.extend_from_slice(&word(64 + 128));
    for s in signatures {
        let sig = bytes::<65>(s)?;
        sigs.extend_from_slice(&word(65));
        sigs.extend_from_slice(&sig);
        sigs.resize(sigs.len() + 31, 0);
    }
    let mut data = keccak(b"execute(uint256,address[],uint64[],bytes[])")[..4].to_vec();
    data.extend_from_slice(&word(nonce));
    data.extend_from_slice(&word(128));
    data.extend_from_slice(&word((128 + addresses.len()) as u64));
    data.extend_from_slice(&word((128 + addresses.len() + amounts.len()) as u64));
    data.extend_from_slice(&addresses);
    data.extend_from_slice(&amounts);
    data.extend_from_slice(&sigs);
    Ok(eth::hex(data))
}
#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> serde_json::Value {
        serde_json::from_str(include_str!(
            "../../../../../demo/ethbridge/vault-fixture.json"
        ))
        .unwrap()
    }
    #[test]
    fn ethereum_eip712_signatures_and_calldata_match_independent_ethers() {
        let f = fixture();
        let payments: Vec<Payment> = serde_json::from_value(f["payments"].clone()).unwrap();
        let vault = f["vault"].as_str().unwrap();
        let deployment = f["deployment"].as_str().unwrap();
        let hash = digest(1337, vault, deployment, 0, &payments).unwrap();
        assert_eq!(eth::hex(hash), f["digest"]);
        assert_eq!(
            eth::hex(payments_hash(&payments).unwrap()),
            f["payments_hash"]
        );
        let mut signatures = vec![];
        for s in f["signatures"].as_array().unwrap() {
            let result = recoverable(
                s["public"].as_str().unwrap(),
                f["digest"].as_str().unwrap(),
                s["compact"].as_str().unwrap(),
            )
            .unwrap();
            assert_eq!(result, s["standard"]);
            signatures.push(result)
        }
        assert_eq!(calldata(0, &payments, &signatures).unwrap(), f["calldata"]);
        assert_ne!(digest(1338, vault, deployment, 0, &payments).unwrap(), hash);
        assert_ne!(digest(1337, vault, deployment, 1, &payments).unwrap(), hash);
        let mut altered = payments;
        altered[0].amount += 1;
        assert_ne!(digest(1337, vault, deployment, 0, &altered).unwrap(), hash);
    }
    #[test]
    fn exact_vault_events_and_fee_conservation() {
        let f = fixture();
        let vault = f["vault"].as_str().unwrap();
        let deposit: eth::ReceiptFact =
            serde_json::from_value(f["deposit"]["fact"]["fact"].clone()).unwrap();
        assert_eq!(
            super::deposit(&deposit, vault).unwrap(),
            (1, 351191174077921280, 1000000)
        );
        let completed: eth::ReceiptFact =
            serde_json::from_value(f["completed"]["fact"]["fact"].clone()).unwrap();
        assert_eq!(
            super::completed(&completed, vault).unwrap(),
            (0, f["payments_hash"].as_str().unwrap().into(), 800000)
        );
        let mut wrong = deposit;
        wrong.address = "00".repeat(20);
        assert!(super::deposit(&wrong, vault).is_err());
        for amount in [1, 999, 1000, 1000000, u64::MAX] {
            let (net, treasury, bounty) = split(amount, 10, 5000).unwrap();
            assert_eq!(
                u128::from(net) + u128::from(treasury) + u128::from(bounty),
                u128::from(amount)
            );
        }
        assert!(split(1, 101, 5000).is_err());
    }
}
