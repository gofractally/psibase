//! Shared, deterministic Bitcoin policy. No network, clock, secret storage or Psibase imports.
pub use bitcoin;
pub use hex;

pub type Result<T> = std::result::Result<T, String>;

use bitcoin::{
    absolute,
    bip32::{ChildNumber, Xpriv, Xpub},
    block::Header,
    consensus::{deserialize, serialize},
    hashes::{sha256, sha256d, Hash},
    opcodes::all::OP_CHECKMULTISIG,
    pow::{CompactTarget, Target, Work},
    script::Builder,
    secp256k1::{ecdsa::Signature, Message, PublicKey, Secp256k1},
    sighash::SighashCache,
    transaction::Version,
    Address, Amount, BlockHash, EcdsaSighashType, Network, OutPoint, ScriptBuf, Sequence,
    Transaction, TxIn, TxOut, Txid, Witness,
};
use serde::{Deserialize, Serialize};
use std::str::FromStr;

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
pub fn decode<T: bitcoin::consensus::Decodable>(s: &str, max_bytes: usize) -> Result<T> {
    if s.len() > max_bytes * 2 {
        return Err("Bitcoin payload exceeds limit".into());
    }
    deserialize(&hex::decode(s).map_err(err)?).map_err(err)
}
pub fn network(s: &str) -> Result<Network> {
    match s {
        "regtest" => Ok(Network::Regtest),
        "bitcoin" => Ok(Network::Bitcoin),
        _ => Err("Only bitcoin and isolated regtest are supported".into()),
    }
}
pub fn header(s: &str) -> Result<Header> {
    decode(s, 80)
}
pub fn hash(s: &str) -> Result<BlockHash> {
    s.parse().map_err(err)
}
pub fn work(s: &str) -> Result<Work> {
    let bytes: [u8; 32] = hex::decode(s)
        .map_err(err)?
        .try_into()
        .map_err(|_| "Invalid chainwork")?;
    Ok(Work::from_be_bytes(bytes))
}
pub fn work_hex(w: Work) -> String {
    hex::encode(w.to_be_bytes())
}
pub fn check_pow(h: &Header, net: &str) -> Result<()> {
    let bits = h.bits.to_consensus();
    let size = bits >> 24;
    let mantissa = bits & 0x007fffff;
    let invalid = mantissa == 0
        || (bits & 0x00800000) != 0
        || size > 34
        || (mantissa > 0xff && size > 33)
        || (mantissa > 0xffff && size > 32);
    let limit = match network(net)? {
        Network::Regtest => Target::MAX_ATTAINABLE_REGTEST,
        _ => Target::MAX_ATTAINABLE_MAINNET,
    };
    if invalid || h.target() == Target::ZERO || h.target() > limit {
        return Err("Invalid proof-of-work target".into());
    }
    h.validate_pow(h.target()).map_err(err)?;
    Ok(())
}
/// `history` is chronological, ending at parent, with the current epoch boundary included.
pub fn validate_header(
    raw: &str,
    height: u32,
    history: &[Header],
    net: &str,
    now: u64,
) -> Result<Header> {
    let parent = *history.last().ok_or("Missing parent")?;
    let times: Vec<_> = history.iter().rev().take(11).map(|h| h.time).collect();
    let epoch = if net == "bitcoin" && height % 2016 == 0 {
        if history.len() < 2016 {
            return Err("Missing difficulty epoch context".into());
        }
        history[history.len() - 2016].time
    } else {
        parent.time
    };
    validate_next_header(raw, height, &parent, &times, epoch, net, now)
}
/// All context is cached per validated parent, so retarget validation requires constant database work.
pub fn validate_next_header(
    raw: &str,
    height: u32,
    parent: &Header,
    times: &[u32],
    epoch_start: u32,
    net: &str,
    now: u64,
) -> Result<Header> {
    let h = header(raw)?;
    check_pow(&h, net)?;
    let minimum_version = if net == "regtest" {
        4
    } else if height >= 388381 {
        4
    } else if height >= 363725 {
        3
    } else if height >= 227931 {
        2
    } else {
        1
    };
    if h.version.to_consensus() < minimum_version {
        return Err("Obsolete Bitcoin header version".into());
    }
    if h.prev_blockhash != parent.block_hash() {
        return Err("Header parent mismatch".into());
    }
    if times.len() != 11.min(height as usize) {
        return Err("Missing median-time context".into());
    }
    let mut times = times.to_vec();
    times.sort_unstable();
    if h.time <= times[times.len() / 2] || h.time as u64 > now.saturating_add(7200) {
        return Err("Invalid header timestamp".into());
    }
    let expected = if net == "regtest" || height % 2016 != 0 {
        parent.bits
    } else {
        let span = (parent.time as i64 - epoch_start as i64).clamp(302400, 4838400) as u64;
        CompactTarget::from_next_work_required(
            parent.bits,
            span,
            bitcoin::consensus::Params::MAINNET,
        )
    };
    if h.bits != expected {
        return Err("Incorrect difficulty transition".into());
    }
    Ok(h)
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Policy {
    pub network: String,
    pub xpubs: Vec<String>,
    pub fee_rate: u64,
    pub max_fee_rate: u64,
    pub service_fee: u64,
    pub min_withdrawal: u64,
    pub min_deposit: u64,
    pub dust: u64,
    pub batch_seconds: u32,
    pub batch_size: u32,
    pub max_inputs: u32,
}
impl Policy {
    pub fn validate(&self) -> Result<()> {
        let net = network(&self.network)?;
        if self.xpubs.len() != 3
            || self.fee_rate == 0
            || self.fee_rate > self.max_fee_rate
            || self.max_fee_rate > 1000
            || self.service_fee > 1_000_000
            || self.min_deposit < 1000
            || self.min_withdrawal < 1000
            || !(330..=10000).contains(&self.dust)
            || self.batch_size == 0
            || self.batch_size > 32
            || self.max_inputs == 0
            || self.max_inputs > 64
            || !(1..=3600).contains(&self.batch_seconds)
        {
            return Err("Unsafe bridge policy limits".into());
        }
        let mut keys = Vec::new();
        for s in &self.xpubs {
            let key = Xpub::from_str(s).map_err(err)?;
            if key.network != net.into() {
                return Err("Extended key network mismatch".into());
            }
            keys.push(key.public_key.serialize());
        }
        keys.sort();
        keys.dedup();
        if keys.len() != 3 {
            return Err("Three independent custody public keys are required".into());
        }
        Ok(())
    }
    pub fn id(&self) -> String {
        sha256::Hash::hash(&serde_json::to_vec(self).unwrap()).to_string()
    }
}

pub fn custody_keys(policy: &Policy, branch: u32, index: u32) -> Result<Vec<(usize, PublicKey)>> {
    if branch > 1 || index >= 1 << 31 {
        return Err("Invalid public derivation path".into());
    }
    let path = [
        ChildNumber::from_normal_idx(branch).map_err(err)?,
        ChildNumber::from_normal_idx(index).map_err(err)?,
    ];
    let secp = Secp256k1::verification_only();
    let mut keys = Vec::new();
    for (i, s) in policy.xpubs.iter().enumerate() {
        keys.push((
            i,
            Xpub::from_str(s)
                .map_err(err)?
                .derive_pub(&secp, &path)
                .map_err(err)?
                .public_key,
        ));
    }
    keys.sort_by_key(|(_, k)| k.serialize());
    if keys.windows(2).any(|w| w[0].1 == w[1].1) {
        return Err("Duplicate derived custody key".into());
    }
    Ok(keys)
}
pub fn witness_script(policy: &Policy, branch: u32, index: u32) -> Result<ScriptBuf> {
    let mut b = Builder::new().push_int(2);
    for (_, k) in custody_keys(policy, branch, index)? {
        b = b.push_key(&bitcoin::PublicKey::new(k));
    }
    Ok(b.push_int(3).push_opcode(OP_CHECKMULTISIG).into_script())
}
pub fn custody_script(policy: &Policy, branch: u32, index: u32) -> Result<ScriptBuf> {
    Ok(witness_script(policy, branch, index)?.to_p2wsh())
}
pub fn custody_address(policy: &Policy, branch: u32, index: u32) -> Result<String> {
    Address::from_script(
        &custody_script(policy, branch, index)?,
        network(&policy.network)?,
    )
    .map(|a| a.to_string())
    .map_err(err)
}
pub fn destination(policy: &Policy, address: &str) -> Result<ScriptBuf> {
    let addr = Address::from_str(address)
        .map_err(err)?
        .require_network(network(&policy.network)?)
        .map_err(err)?;
    let script = addr.script_pubkey();
    if !(script.is_p2pkh()
        || script.is_p2sh()
        || script.is_p2wpkh()
        || script.is_p2wsh()
        || script.is_p2tr())
    {
        return Err("Unsupported withdrawal destination".into());
    }
    Ok(script)
}

pub fn prove_transaction(
    raw: &str,
    block: &Header,
    siblings: &[String],
    mut position: u32,
) -> Result<Transaction> {
    let tx: Transaction = decode(raw, 400_000)?;
    if tx.input.is_empty() || tx.output.is_empty() || tx.is_coinbase() {
        return Err("Coinbase/empty deposits unsupported".into());
    }
    let stripped = tx.base_size();
    // Bitcoin's tree has no domain separation. A 64-byte leaf can be confused with an internal node.
    if stripped == 64 || siblings.len() > 32 {
        return Err("Ambiguous or oversized Merkle proof".into());
    }
    let mut node = tx.compute_txid().to_byte_array();
    for sibling in siblings {
        let other = Txid::from_str(sibling).map_err(err)?.to_byte_array();
        let mut pair = [0u8; 64];
        let (left, right) = if position & 1 == 0 {
            (node, other)
        } else {
            (other, node)
        };
        pair[..32].copy_from_slice(&left);
        pair[32..].copy_from_slice(&right);
        node = sha256d::Hash::hash(&pair).to_byte_array();
        position >>= 1;
    }
    if position != 0 || node != block.merkle_root.to_byte_array() {
        return Err("Merkle proof does not match header".into());
    }
    Ok(tx)
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Input {
    pub txid: String,
    pub vout: u32,
    pub value: u64,
    pub branch: u32,
    pub index: u32,
    pub height: u32,
}
impl Input {
    pub fn id(&self) -> String {
        format!("{}:{:08x}", self.txid, self.vout)
    }
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Payment {
    pub id: u64,
    pub script: String,
    pub amount: u64,
    pub max_fee: u64,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Plan {
    pub policy_id: String,
    pub batch: u32,
    pub inputs: Vec<Input>,
    pub payments: Vec<Payment>,
    pub fees: Vec<u64>,
    pub fee: u64,
    pub change: u64,
    pub unsigned: String,
    pub txid: String,
}
fn add(a: u64, b: u64) -> Result<u64> {
    a.checked_add(b).ok_or("Satoshi arithmetic overflow".into())
}
pub fn build_plan(
    policy: &Policy,
    batch: u32,
    candidates: &[Input],
    requests: &[Payment],
) -> Result<Plan> {
    build_plan_inner(policy, batch, candidates, requests, true)
}
/// Quote the exact deterministic transaction before rejecting insufficient individual fee allowances.
pub fn quote_plan(
    policy: &Policy,
    batch: u32,
    candidates: &[Input],
    requests: &[Payment],
) -> Result<Plan> {
    build_plan_inner(policy, batch, candidates, requests, false)
}
fn build_plan_inner(
    policy: &Policy,
    batch: u32,
    candidates: &[Input],
    requests: &[Payment],
    enforce_caps: bool,
) -> Result<Plan> {
    policy.validate()?;
    if batch >= 1 << 31
        || requests.is_empty()
        || requests.len() > policy.batch_size as usize
        || candidates.len() > 256
    {
        return Err("Batch size limit".into());
    }
    let mut payments = requests.to_vec();
    payments.sort_by_key(|r| r.id);
    if payments.windows(2).any(|w| w[0].id == w[1].id) {
        return Err("Duplicate withdrawal request".into());
    }
    let mut output = Vec::new();
    let mut total = 0;
    for p in &payments {
        if p.amount < policy.min_withdrawal || p.amount > bitcoin::Amount::MAX_MONEY.to_sat() {
            return Err("Withdrawal amount limit".into());
        }
        let script = ScriptBuf::from_bytes(hex::decode(&p.script).map_err(err)?);
        if !(script.is_p2pkh()
            || script.is_p2sh()
            || script.is_p2wpkh()
            || script.is_p2wsh()
            || script.is_p2tr())
        {
            return Err("Unsupported withdrawal script".into());
        }
        total = add(total, p.amount)?;
        output.push(TxOut {
            value: Amount::from_sat(p.amount),
            script_pubkey: script,
        });
    }
    let mut candidates = candidates.to_vec();
    candidates.sort_by(|a, b| (a.height, &a.txid, a.vout).cmp(&(b.height, &b.txid, b.vout)));
    let mut seen = std::collections::BTreeSet::new();
    for i in &candidates {
        if i.value == 0 || i.value > Amount::MAX_MONEY.to_sat() || !seen.insert(i.id()) {
            return Err("Invalid/duplicate custody input".into());
        }
        Txid::from_str(&i.txid).map_err(err)?;
        if i.branch > 1 || i.index >= 1 << 31 {
            return Err("Invalid custody input derivation".into());
        }
    }
    let change_script = custody_script(policy, 1, batch)?;
    let mut inputs = Vec::new();
    let mut value = 0;
    for input in candidates.into_iter().take(policy.max_inputs as usize) {
        value = add(value, input.value)?;
        inputs.push(input);
        let mut tx = Transaction {
            version: Version::TWO,
            lock_time: absolute::LockTime::ZERO,
            input: inputs
                .iter()
                .map(|i| {
                    Ok(TxIn {
                        previous_output: OutPoint {
                            txid: i.txid.parse().map_err(err)?,
                            vout: i.vout,
                        },
                        script_sig: ScriptBuf::new(),
                        sequence: Sequence::ENABLE_RBF_NO_LOCKTIME,
                        witness: Witness::new(),
                    })
                })
                .collect::<Result<_>>()?,
            output: output.clone(),
        };
        // Always require an economical change output. Never silently donate dust to miners.
        tx.output.push(TxOut {
            value: Amount::ZERO,
            script_pubkey: change_script.clone(),
        });
        for (n, i) in inputs.iter().enumerate() {
            // Every registered input uses the same 105-byte sorted 2-of-3 compressed-key script.
            // Its contents affect the sighash, but only its size affects this conservative fee quote.
            let _ = i;
            tx.input[n].witness =
                Witness::from_slice(&[vec![], vec![0; 73], vec![0; 73], vec![0; 105]]);
        }
        let fee = (tx.vsize() as u64)
            .checked_mul(policy.fee_rate)
            .ok_or("Fee overflow")?;
        if value < add(add(total, fee)?, policy.dust)? {
            continue;
        }
        let change = value - total - fee;
        tx.output.last_mut().unwrap().value = Amount::from_sat(change);
        for input in &mut tx.input {
            input.witness = Witness::new();
        }
        let count = payments.len() as u64;
        let fees: Vec<_> = (0..count)
            .map(|i| fee / count + u64::from(i < fee % count))
            .collect();
        if enforce_caps && payments.iter().zip(&fees).any(|(p, f)| *f > p.max_fee) {
            return Err("Withdrawal network fee cap exceeded".into());
        }
        return Ok(Plan {
            policy_id: policy.id(),
            batch,
            inputs,
            payments,
            fees,
            fee,
            change,
            txid: tx.compute_txid().to_string(),
            unsigned: hex::encode(serialize(&tx)),
        });
    }
    Err("Insufficient confirmed UTXOs (including economical change and fees)".into())
}
pub fn check_plan(policy: &Policy, plan: &Plan) -> Result<()> {
    let rebuilt = build_plan(policy, plan.batch, &plan.inputs, &plan.payments)?;
    if &rebuilt != plan {
        return Err("Transaction differs from deterministic batch".into());
    }
    Ok(())
}
pub fn sighash(policy: &Policy, plan: &Plan, n: usize) -> Result<Message> {
    let tx: Transaction = decode(&plan.unsigned, 100_000)?;
    let i = plan.inputs.get(n).ok_or("Input index")?;
    let h = SighashCache::new(&tx)
        .p2wsh_signature_hash(
            n,
            &witness_script(policy, i.branch, i.index)?,
            Amount::from_sat(i.value),
            EcdsaSighashType::All,
        )
        .map_err(err)?;
    Ok(Message::from_digest(h.to_byte_array()))
}
pub fn sign_plan(policy: &Policy, plan: &Plan, key: &Xpriv) -> Result<(u8, Vec<String>)> {
    check_plan(policy, plan)?;
    let secp = Secp256k1::new();
    let xpub = Xpub::from_priv(&secp, key).to_string();
    let signer = policy
        .xpubs
        .iter()
        .position(|s| *s == xpub)
        .ok_or("Signer key does not match custody policy")?;
    let mut sigs = Vec::new();
    for (n, i) in plan.inputs.iter().enumerate() {
        let path = [
            ChildNumber::from_normal_idx(i.branch).map_err(err)?,
            ChildNumber::from_normal_idx(i.index).map_err(err)?,
        ];
        let child = key.derive_priv(&secp, &path).map_err(err)?;
        let sig = secp.sign_ecdsa(&sighash(policy, plan, n)?, &child.private_key);
        let mut bytes = sig.serialize_der().to_vec();
        bytes.push(EcdsaSighashType::All as u8);
        sigs.push(hex::encode(bytes));
    }
    Ok((signer as u8, sigs))
}
pub fn verify_signatures(policy: &Policy, plan: &Plan, signer: u8, sigs: &[String]) -> Result<()> {
    if signer >= 3 || sigs.len() != plan.inputs.len() {
        return Err("Wrong signer/signature count".into());
    }
    let secp = Secp256k1::verification_only();
    for (n, i) in plan.inputs.iter().enumerate() {
        let bytes = hex::decode(&sigs[n]).map_err(err)?;
        if bytes.len() < 9
            || bytes.len() > 73
            || *bytes.last().unwrap() != EcdsaSighashType::All as u8
        {
            return Err("Only canonical SIGHASH_ALL signatures accepted".into());
        }
        let sig = Signature::from_der(&bytes[..bytes.len() - 1]).map_err(err)?;
        let mut normalized = sig;
        normalized.normalize_s();
        if normalized != sig {
            return Err("Noncanonical high-S signature".into());
        }
        let key = custody_keys(policy, i.branch, i.index)?
            .into_iter()
            .find(|(s, _)| *s == signer as usize)
            .unwrap()
            .1;
        secp.verify_ecdsa(&sighash(policy, plan, n)?, &sig, &key)
            .map_err(err)?;
    }
    Ok(())
}
pub fn finalize(policy: &Policy, plan: &Plan, signatures: &[(u8, Vec<String>)]) -> Result<String> {
    check_plan(policy, plan)?;
    let mut provided = std::collections::BTreeMap::new();
    for (signer, sigs) in signatures {
        verify_signatures(policy, plan, *signer, sigs)?;
        if provided.insert(*signer, sigs).is_some() {
            return Err("Duplicate signer".into());
        }
    }
    if provided.len() < 2 {
        return Err("Two independent signatures required".into());
    }
    let mut tx: Transaction = decode(&plan.unsigned, 100_000)?;
    for (n, i) in plan.inputs.iter().enumerate() {
        let mut witness = vec![vec![]];
        for (s, _) in custody_keys(policy, i.branch, i.index)? {
            if let Some(sigs) = provided.get(&(s as u8)) {
                witness.push(hex::decode(&sigs[n]).map_err(err)?);
                if witness.len() == 3 {
                    break;
                }
            }
        }
        witness.push(witness_script(policy, i.branch, i.index)?.into_bytes());
        tx.input[n].witness = Witness::from_slice(&witness);
    }
    Ok(hex::encode(serialize(&tx)))
}

/// Split only existing backing; all arithmetic is integer satoshis, rounded down.
pub fn deposit_split(value: u64, fee_bps: u16, publisher_bps: u16) -> Result<(u64, u64, u64)> {
    if fee_bps > 100 || publisher_bps > 10_000 {
        return Err("Deposit fee policy exceeds limits".into());
    }
    let fee = (u128::from(value) * u128::from(fee_bps) / 10_000) as u64;
    let bounty = (u128::from(fee) * u128::from(publisher_bps) / 10_000) as u64;
    Ok((value - fee, fee - bounty, bounty))
}
#[cfg(test)]
mod deposit_fee_tests {
    #[test]
    fn fees_conserve_backing_and_round_down() {
        assert_eq!(
            super::deposit_split(100_000_000, 10, 5000).unwrap(),
            (99_900_000, 50_000, 50_000)
        );
        assert_eq!(super::deposit_split(1000, 10, 5000).unwrap(), (999, 1, 0));
        for value in [0, 1, 999, 1000, 100_000_001, 2_100_000_000_000_000] {
            for fee in [0, 1, 10, 100] {
                for bounty in [0, 1, 5000, 10_000] {
                    let (net, treasury, reward) = super::deposit_split(value, fee, bounty).unwrap();
                    assert_eq!(net + treasury + reward, value);
                }
            }
        }
        assert!(super::deposit_split(1000, 101, 5000).is_err());
        assert!(super::deposit_split(1000, 10, 10_001).is_err());
    }
}
