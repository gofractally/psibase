//! Signet block signatures (BIP 325), checked from a header, its coinbase transaction and the
//! coinbase's Merkle branch. Where the BIP is silent this follows Bitcoin Core's `signet.cpp`.
//!
//! Only one challenge template is supported: a bare `m`-of-`n` `OP_CHECKMULTISIG`, which is what the
//! default signet uses (1-of-2). A solution is `OP_0` followed by `m` signatures in the scriptSig and
//! an empty witness stack. Anything else is refused.
use crate::{decode, Result};
use bitcoin::{
    absolute,
    block::Header,
    consensus::encode::{deserialize, deserialize_partial},
    hashes::{sha256d, Hash},
    secp256k1::{ecdsa::Signature, Message, PublicKey, Secp256k1},
    sighash::SighashCache,
    transaction::Version,
    Amount, OutPoint, ScriptBuf, Sequence, Transaction, TxIn, TxOut, Txid, Witness,
};
use std::str::FromStr;

/// BIP 325: "4 bytes - Signet header (0xecc7daa2)".
pub const SIGNET_HEADER: [u8; 4] = [0xec, 0xc7, 0xda, 0xa2];
/// Bitcoin Core `src/kernel/signet.h`, `SIGNET_DEFAULT_CHALLENGE`: `1 <key> <key> 2 OP_CHECKMULTISIG`.
pub const DEFAULT_SIGNET_CHALLENGE: &str = "512103ad5e0edad18cb1f0fc0d28a3d4f1f3e445640337489abb10404f2d1e086be430210359ef5021964fe22d6f8e05b2463c9540ce96883fe3b278760f048f5189f2e6c452ae";
/// The same bounds as a deposit proof.
pub const MAX_COINBASE_BYTES: usize = 400_000;
pub const MAX_BRANCH: usize = 32;
/// `6a 24 aa21a9ed`: OP_RETURN, a 36-byte push, the BIP 141 commitment tag.
const WITNESS_COMMITMENT: [u8; 6] = [0x6a, 0x24, 0xaa, 0x21, 0xa9, 0xed];
const MINIMUM_WITNESS_COMMITMENT: usize = 38;
const OP_PUSHDATA1: u8 = 0x4c;
const OP_PUSHDATA2: u8 = 0x4d;
const OP_PUSHDATA4: u8 = 0x4e;
const OP_1: u8 = 0x51;
const OP_16: u8 = 0x60;
const OP_RETURN: u8 = 0x6a;
const OP_CHECKMULTISIG: u8 = 0xae;

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

/// The block challenge of one signet, parsed as `OP_m <keys> OP_n OP_CHECKMULTISIG`.
#[derive(Clone, Debug)]
pub struct SignetParams {
    challenge: ScriptBuf,
    required: usize,
    keys: Vec<PublicKey>,
}
impl SignetParams {
    /// The default (global) signet.
    pub fn default_signet() -> Self {
        Self::from_challenge(DEFAULT_SIGNET_CHALLENGE).expect("default signet challenge")
    }
    pub fn from_challenge(challenge_hex: &str) -> Result<Self> {
        const UNSUPPORTED: &str = "Unsupported signet challenge: only bare m-of-n multisig";
        if challenge_hex.len() > 2 * 1024 {
            return Err(UNSUPPORTED.into());
        }
        let script = hex::decode(challenge_hex).map_err(err)?;
        let mut at = 0;
        let mut ops = Vec::new();
        while at < script.len() {
            ops.push(next_op(&script, &mut at).ok_or(UNSUPPORTED)?);
        }
        if ops.len() < 4 || ops[ops.len() - 1].0 != OP_CHECKMULTISIG {
            return Err(UNSUPPORTED.into());
        }
        let small = |op: u8| (OP_1..=OP_16).contains(&op).then(|| (op - OP_1 + 1) as usize);
        let required = small(ops[0].0).ok_or(UNSUPPORTED)?;
        let count = small(ops[ops.len() - 2].0).ok_or(UNSUPPORTED)?;
        let mut keys = Vec::new();
        for (op, data) in &ops[1..ops.len() - 2] {
            // Direct pushes of a compressed or uncompressed key only.
            if *op as usize != data.len() || !(data.len() == 33 || data.len() == 65) {
                return Err(UNSUPPORTED.into());
            }
            keys.push(PublicKey::from_slice(data).map_err(|_| UNSUPPORTED)?);
        }
        if keys.len() != count || required > count {
            return Err(UNSUPPORTED.into());
        }
        Ok(Self {
            challenge: ScriptBuf::from_bytes(script),
            required,
            keys,
        })
    }
    pub fn challenge(&self) -> &ScriptBuf {
        &self.challenge
    }
}

/// One script operation as Bitcoin Core's `CScript::GetOp` reads it: the opcode and, for the push
/// opcodes, the pushed bytes. `None` at a malformed operation.
fn next_op<'a>(script: &'a [u8], at: &mut usize) -> Option<(u8, &'a [u8])> {
    let op = *script.get(*at)?;
    *at += 1;
    let width = match op {
        0..=0x4b => 0,
        OP_PUSHDATA1 => 1,
        OP_PUSHDATA2 => 2,
        OP_PUSHDATA4 => 4,
        _ => return Some((op, &[])),
    };
    let mut size = op as usize;
    if width > 0 {
        let bytes = script.get(*at..*at + width)?;
        size = bytes.iter().rev().fold(0, |n, b| n << 8 | *b as usize);
        *at += width;
    }
    let data = script.get(*at..at.checked_add(size)?)?;
    *at += size;
    Some((op, data))
}
/// `CScript::operator<<(vector)`: the shortest push opcode for the length.
fn push(script: &mut Vec<u8>, data: &[u8]) {
    match data.len() {
        n if n < OP_PUSHDATA1 as usize => script.push(n as u8),
        n if n <= 0xff => script.extend([OP_PUSHDATA1, n as u8]),
        n if n <= 0xffff => {
            script.push(OP_PUSHDATA2);
            script.extend((n as u16).to_le_bytes())
        }
        n => {
            script.push(OP_PUSHDATA4);
            script.extend((n as u32).to_le_bytes())
        }
    }
    script.extend(data);
}

/// Bitcoin Core's `FetchAndClearCommitmentSection`: the commitment script with the first signet push
/// cut down to its four header bytes, and the solution that was cut out. BIP 325: "Any push
/// operations that do not start with the 4 byte Signet header are ignored. Multiple push operations
/// with the 4 byte Signet header are ignored except for the first instance of the header."
///
/// As in Core the script is rebuilt operation by operation (every push re-encoded in its shortest
/// form) and rebuilding stops at a malformed operation. `None` when there is no signet push.
pub fn split_commitment(commitment: &[u8]) -> Option<(Vec<u8>, Vec<u8>)> {
    let mut replacement = Vec::with_capacity(commitment.len());
    let mut solution = None;
    let mut at = 0;
    while let Some((op, data)) = next_op(commitment, &mut at) {
        if data.is_empty() {
            replacement.push(op);
        } else if solution.is_none() && data.len() > 4 && data[..4] == SIGNET_HEADER {
            // A push counts only if it has the header and some data.
            solution = Some(data[4..].to_vec());
            push(&mut replacement, &SIGNET_HEADER);
        } else {
            push(&mut replacement, data);
        }
    }
    solution.map(|s| (replacement, s))
}

/// `GetWitnessCommitmentIndex`: the last output carrying the BIP 141 commitment.
fn commitment_index(coinbase: &Transaction) -> Option<usize> {
    coinbase.output.iter().rposition(|o| {
        let s = o.script_pubkey.as_bytes();
        s.len() >= MINIMUM_WITNESS_COMMITMENT && s[..6] == WITNESS_COMMITMENT
    })
}

/// The coinbase is leaf 0: fold a transaction ID up its branch, always as the left node.
fn fold(leaf: Txid, branch: &[[u8; 32]]) -> [u8; 32] {
    let mut node = leaf.to_byte_array();
    for sibling in branch {
        let mut pair = [0u8; 64];
        pair[..32].copy_from_slice(&node);
        pair[32..].copy_from_slice(sibling);
        node = sha256d::Hash::hash(&pair).to_byte_array();
    }
    node
}

/// The two virtual transactions of BIP 325 for one block.
#[derive(Clone, Debug)]
pub struct SignetTxs {
    pub to_spend: Transaction,
    pub to_sign: Transaction,
    /// Merkle root of the block with the solution removed from the coinbase (internal byte order).
    pub signet_merkle_root: [u8; 32],
}

/// Build `to_spend` and `to_sign` from a header, its raw coinbase transaction (hex, with or without
/// witness data) and the coinbase's Merkle branch (hex transaction-ID order, leaf to root).
///
/// Checks that the coinbase and branch belong to the header. Does not check the signature.
pub fn signet_txs(
    header: &Header,
    coinbase_hex: &str,
    branch: &[String],
    params: &SignetParams,
) -> Result<SignetTxs> {
    if branch.len() > MAX_BRANCH {
        return Err("Oversized coinbase Merkle branch".into());
    }
    let mut coinbase: Transaction = decode(coinbase_hex, MAX_COINBASE_BYTES)?;
    // Bitcoin's tree has no domain separation: a 64-byte "transaction" may be an internal node.
    if !coinbase.is_coinbase() || coinbase.base_size() == 64 {
        return Err("Signet proof needs the block's coinbase transaction".into());
    }
    let mut siblings = Vec::with_capacity(branch.len());
    for sibling in branch {
        siblings.push(Txid::from_str(sibling).map_err(err)?.to_byte_array());
    }
    // The transaction ID leaves out witness data, so this is the leaf whichever form was supplied.
    if fold(coinbase.compute_txid(), &siblings) != header.merkle_root.to_byte_array() {
        return Err("Coinbase proof does not match header".into());
    }
    let index = commitment_index(&coinbase).ok_or("Signet block has no witness commitment")?;
    let (replacement, solution) =
        split_commitment(coinbase.output[index].script_pubkey.as_bytes())
            .ok_or("Signet block has no solution")?;
    // "The scriptSig is serialized by first encoding its length as CompactSize. The scriptWitness
    // stack is serialized as described in BIP 141." Nothing may follow.
    let (script_sig, used): (ScriptBuf, usize) =
        deserialize_partial(&solution).map_err(|_| "Malformed signet solution")?;
    let witness: Witness =
        deserialize(&solution[used..]).map_err(|_| "Malformed signet solution")?;

    // Same branch, modified leaf: no sibling on the path of leaf 0 depends on the coinbase.
    coinbase.output[index].script_pubkey = ScriptBuf::from_bytes(replacement);
    let signet_merkle_root = fold(coinbase.compute_txid(), &siblings);

    // "block_data is the serialization of the block's nVersion, hashPrevBlock, signet_merkle_root,
    // and nTime."; "vin[0].scriptSig = OP_0 PUSH72[ block_data ]".
    let mut spend_script = vec![0x00, 72];
    spend_script.extend(header.version.to_consensus().to_le_bytes());
    spend_script.extend(header.prev_blockhash.to_byte_array());
    spend_script.extend(signet_merkle_root);
    spend_script.extend(header.time.to_le_bytes());
    let transaction = |previous_output, script_sig, witness, script_pubkey| Transaction {
        version: Version(0),
        lock_time: absolute::LockTime::ZERO,
        input: vec![TxIn {
            previous_output,
            script_sig,
            sequence: Sequence(0),
            witness,
        }],
        output: vec![TxOut {
            value: Amount::ZERO,
            script_pubkey,
        }],
    };
    let to_spend = transaction(
        OutPoint::null(),
        ScriptBuf::from_bytes(spend_script),
        Witness::new(),
        params.challenge.clone(),
    );
    let to_sign = transaction(
        OutPoint {
            txid: to_spend.compute_txid(),
            vout: 0,
        },
        script_sig,
        witness,
        ScriptBuf::from_bytes(vec![OP_RETURN]),
    );
    Ok(SignetTxs {
        to_spend,
        to_sign,
        signet_merkle_root,
    })
}

/// The pre-SegWit signature hash of `to_sign`'s only input, with the challenge as script code.
pub fn signet_sighash(params: &SignetParams, to_sign: &Transaction, hash_type: u8) -> [u8; 32] {
    SighashCache::new(to_sign)
        .legacy_signature_hash(0, &params.challenge, hash_type as u32)
        .expect("to_sign has one input")
        .to_byte_array()
}

/// BIP 66 (`SCRIPT_VERIFY_DERSIG`), over the signature including its hash-type byte.
fn strict_der(sig: &[u8]) -> bool {
    if sig.len() < 9 || sig.len() > 73 || sig[0] != 0x30 || sig[1] as usize != sig.len() - 3 {
        return false;
    }
    let len_r = sig[3] as usize;
    if 5 + len_r >= sig.len() {
        return false;
    }
    let len_s = sig[5 + len_r] as usize;
    if len_r + len_s + 7 != sig.len() {
        return false;
    }
    let integer = |tag: u8, bytes: &[u8]| {
        tag == 0x02
            && !bytes.is_empty()
            && bytes[0] & 0x80 == 0
            && !(bytes.len() > 1 && bytes[0] == 0 && bytes[1] & 0x80 == 0)
    };
    integer(sig[2], &sig[4..4 + len_r]) && integer(sig[4 + len_r], &sig[6 + len_r..6 + len_r + len_s])
}

/// Verify a signet block's signature. `Ok` means `to_sign` is a valid spend of `to_spend` under the
/// one supported template, with the script rules Bitcoin Core applies to signet solutions: strict
/// DER signatures and an empty multisig dummy. Low-S is not a signet rule and is not required.
///
/// Proof of work and the header's place in the chain are separate checks (`validate_next_header`):
/// the signature covers version, previous block, transactions and time, not `bits` or the nonce.
pub fn verify_signet_block(
    header: &Header,
    coinbase_hex: &str,
    branch: &[String],
    params: &SignetParams,
) -> Result<()> {
    const REFUSED: &str = "Signet solution is not OP_0 and the required multisig signatures";
    let txs = signet_txs(header, coinbase_hex, branch, params)?;
    let input = &txs.to_sign.input[0];
    // A bare script may not be spent with witness data.
    if !input.witness.is_empty() {
        return Err(REFUSED.into());
    }
    let script = input.script_sig.as_bytes();
    let mut at = 0;
    let mut pushes = Vec::new();
    while at < script.len() {
        let (op, data) = next_op(script, &mut at).ok_or(REFUSED)?;
        if op > OP_PUSHDATA4 || pushes.len() > params.required {
            return Err(REFUSED.into());
        }
        pushes.push(data);
    }
    // The dummy element OP_CHECKMULTISIG consumes must be empty (`SCRIPT_VERIFY_NULLDUMMY`).
    if pushes.len() != params.required + 1 || !pushes[0].is_empty() {
        return Err(REFUSED.into());
    }
    let signatures = &pushes[1..];
    let secp = Secp256k1::verification_only();
    // OP_CHECKMULTISIG: signatures in key order, each key tried at most once.
    let (mut sig, mut key) = (signatures.len(), params.keys.len());
    while sig > 0 {
        if sig > key {
            return Err("Invalid signet block signature".into());
        }
        let bytes = signatures[sig - 1];
        if !strict_der(bytes) {
            return Err("Signet signature is not strict DER".into());
        }
        let (der, hash_type) = bytes.split_at(bytes.len() - 1);
        let mut signature = Signature::from_der(der).map_err(err)?;
        signature.normalize_s();
        let digest = Message::from_digest(signet_sighash(params, &txs.to_sign, hash_type[0]));
        if secp
            .verify_ecdsa(&digest, &signature, &params.keys[key - 1])
            .is_ok()
        {
            sig -= 1;
        }
        key -= 1;
    }
    Ok(())
}
