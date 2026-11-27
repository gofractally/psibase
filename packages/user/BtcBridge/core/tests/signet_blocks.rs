//! BIP 325 block signatures against real default-signet blocks, and the forgeries they exist to stop.
use bitcoin::{block::Header, hashes::Hash};
use btcbridge_core::signet::{split_commitment, DEFAULT_SIGNET_CHALLENGE, SIGNET_HEADER};
use btcbridge_core::*;
use serde_json::Value;

struct Block {
    height: u64,
    header: Header,
    coinbase: String,
    branch: Vec<String>,
    signer: u64,
    independent: Value,
}
fn text(v: &Value) -> String {
    v.as_str().unwrap().to_string()
}
fn fixture() -> Value {
    serde_json::from_str(include_str!("fixtures/signet-blocks-bip325.json")).unwrap()
}
fn blocks() -> Vec<Block> {
    fixture()["blocks"]
        .as_array()
        .unwrap()
        .iter()
        .map(|b| {
            let parsed = header(b["header"].as_str().unwrap()).unwrap();
            assert_eq!(parsed.block_hash().to_string(), text(&b["hash"]));
            Block {
                height: b["height"].as_u64().unwrap(),
                header: parsed,
                coinbase: text(&b["coinbase"]),
                branch: b["branch"].as_array().unwrap().iter().map(text).collect(),
                signer: b["signer"].as_u64().unwrap(),
                independent: b["independent"].clone(),
            }
        })
        .collect()
}
fn block(height: u64) -> Block {
    blocks().into_iter().find(|b| b.height == height).unwrap()
}
fn params() -> SignetParams {
    signet_params("signet").unwrap().unwrap()
}
/// Offset of the signet solution inside the raw coinbase hex, and its length in hex digits.
fn solution_span(coinbase: &str) -> (usize, usize) {
    let at = coinbase.find("ecc7daa2").unwrap() + 8;
    // scriptSig length (one byte here), the scriptSig, then the empty witness stack.
    let script = usize::from_str_radix(&coinbase[at..at + 2], 16).unwrap();
    (at, 2 + 2 * script + 2)
}
fn flip(coinbase: &str, hex_index: usize) -> String {
    let mut bytes = coinbase.as_bytes().to_vec();
    bytes[hex_index] = if bytes[hex_index] == b'0' { b'1' } else { b'0' };
    String::from_utf8(bytes).unwrap()
}

#[test]
fn real_blocks_from_both_signers_verify() {
    let p = params();
    assert_eq!(hex::encode(p.challenge().as_bytes()), DEFAULT_SIGNET_CHALLENGE);
    assert_eq!(text(&fixture()["challenge"]), DEFAULT_SIGNET_CHALLENGE);
    let all = blocks();
    assert_eq!(all.len(), 7);
    for b in &all {
        check_pow(&b.header, "signet").unwrap();
        verify_signet_block(&b.header, &b.coinbase, &b.branch, &p)
            .unwrap_or_else(|e| panic!("block {}: {e}", b.height));
    }
    // Both keys of the 1-of-2 challenge, single-transaction blocks, and a retarget block.
    assert!(all.iter().any(|b| b.signer == 0) && all.iter().any(|b| b.signer == 1));
    assert!(block(1).branch.is_empty() && block(332_466).branch.is_empty());
    assert_eq!(block(332_640).branch.len(), 9);
    assert_ne!(block(332_640).header.bits, block(332_639).header.bits);
}

#[test]
fn virtual_transactions_match_an_independent_implementation() {
    let p = params();
    for b in blocks() {
        let txs = signet_txs(&b.header, &b.coinbase, &b.branch, &p).unwrap();
        let mut root = txs.signet_merkle_root;
        root.reverse();
        assert_eq!(hex::encode(root), text(&b.independent["signet_merkle_root"]));
        assert_ne!(txs.signet_merkle_root, b.header.merkle_root.to_byte_array());
        assert_eq!(
            txs.to_spend.compute_txid().to_string(),
            text(&b.independent["to_spend_txid"])
        );
        assert_eq!(
            hex::encode(signet_sighash(&p, &txs.to_sign, 1)),
            text(&b.independent["sighash"]),
            "block {}",
            b.height
        );
        // BIP 325's fixed fields.
        assert_eq!(txs.to_spend.version.0, 0);
        assert_eq!(txs.to_spend.input[0].script_sig.len(), 74);
        assert_eq!(txs.to_sign.output[0].script_pubkey.as_bytes(), [0x6a]);
        assert_eq!(txs.to_sign.input[0].previous_output.vout, 0);
        assert!(txs.to_sign.input[0].witness.is_empty());
    }
}

#[test]
fn valid_work_without_a_valid_signature_is_refused() {
    let p = params();
    let forged = &fixture()["forged"];
    let real = block(332_641);

    // The real block with its time moved by a second and the nonce re-ground: proof of work and
    // the coinbase proof still hold, the signature does not.
    let moved = header(forged["time_changed"]["header"].as_str().unwrap()).unwrap();
    assert_eq!(moved.time, real.header.time + 1);
    assert_eq!(moved.merkle_root, real.header.merkle_root);
    check_pow(&moved, "signet").unwrap();
    signet_txs(&moved, &real.coinbase, &real.branch, &p).unwrap();
    assert_eq!(
        verify_signet_block(&moved, &real.coinbase, &real.branch, &p).unwrap_err(),
        "Invalid signet block signature"
    );

    // A forged child of the real block, carrying that block's coinbase (and so its solution) as
    // its only transaction. It passes every header rule the relay has.
    let child = forged["child_reusing_solution"]["header"].as_str().unwrap();
    let parent_times = vec![real.header.time; 11];
    let accepted = validate_next_header(
        child,
        332_642,
        &real.header,
        &parent_times,
        0,
        "signet",
        real.header.time as u64 + 600,
    );
    // (Median time is the only context needed off a retarget boundary.)
    let child = accepted.unwrap();
    assert_eq!(child.prev_blockhash, real.header.block_hash());
    assert_eq!(
        verify_signet_block(&child, &real.coinbase, &[], &p).unwrap_err(),
        "Invalid signet block signature"
    );
}

#[test]
fn tampered_solutions_are_refused() {
    let p = params();
    let b = block(332_644);
    let ok = |coinbase: &str, branch: &[String]| verify_signet_block(&b.header, coinbase, branch, &p);
    ok(&b.coinbase, &b.branch).unwrap();
    let (at, len) = solution_span(&b.coinbase);

    // One bit of the signature's S value.
    let flipped = flip(&b.coinbase, at + len - 8);
    assert!(ok(&flipped, &b.branch).unwrap_err().starts_with("Coinbase proof"));

    // The solution is not covered by the signature, but it is covered by the header's Merkle
    // root: any change to it must be presented with the header it belongs to. So test the
    // signature rules directly on the single-transaction block, re-deriving its Merkle root.
    let single = block(332_466);
    let (at, len) = solution_span(&single.coinbase);
    let with = |coinbase: String| {
        let tx: bitcoin::Transaction = decode(&coinbase, 400_000).unwrap();
        let mut h = single.header;
        h.merkle_root = bitcoin::TxMerkleNode::from_byte_array(tx.compute_txid().to_byte_array());
        verify_signet_block(&h, &coinbase, &[], &p)
    };
    with(single.coinbase.clone()).unwrap();
    assert_eq!(
        with(flip(&single.coinbase, at + len - 8)).unwrap_err(),
        "Invalid signet block signature"
    );
    // Hash type other than the one signed.
    let mut other_type = single.coinbase.clone();
    other_type.replace_range(at + len - 4..at + len - 2, "02");
    assert_eq!(with(other_type).unwrap_err(), "Invalid signet block signature");
    // Not strict DER: a negative R.
    let mut negative = single.coinbase.clone();
    negative.replace_range(at + 14..at + 16, "80");
    assert_eq!(with(negative).unwrap_err(), "Signet signature is not strict DER");
    // The solution of another block.
    let other = block(332_639);
    let (other_at, other_len) = solution_span(&other.coinbase);
    assert_eq!(other_len, len);
    let mut swapped = single.coinbase.clone();
    swapped.replace_range(at..at + len, &other.coinbase[other_at..other_at + other_len]);
    assert_eq!(with(swapped).unwrap_err(), "Invalid signet block signature");
    // Rebuild the commitment around other solutions made from the real scriptSig.
    let tx: bitcoin::Transaction = decode(&single.coinbase, 400_000).unwrap();
    let (_, solution) = split_commitment(tx.output[1].script_pubkey.as_bytes()).unwrap();
    assert_eq!((solution[0], solution[1], solution[2], solution[74]), (73, 0, 71, 0));
    let script_sig = &solution[1..74];
    let solved = |script_sig: &[u8], witness: &[u8]| {
        let mut push = SIGNET_HEADER.to_vec();
        push.push(script_sig.len() as u8);
        push.extend(script_sig);
        push.extend(witness);
        let mut script = tx.output[1].script_pubkey.as_bytes()[..38].to_vec();
        script.extend([0x4c, push.len() as u8]);
        script.extend(push);
        let mut changed = tx.clone();
        changed.output[1].script_pubkey = bitcoin::ScriptBuf::from_bytes(script);
        with(hex::encode(bitcoin::consensus::serialize(&changed)))
    };
    solved(script_sig, &[0]).unwrap();
    let refused = |r: Result<()>| assert!(r.unwrap_err().starts_with("Signet solution is not"));
    // A witness stack (one empty item): not the supported template.
    refused(solved(script_sig, &[1, 0]));
    // A non-empty multisig dummy.
    refused(solved(&[&[1u8, 0][..], &script_sig[1..]].concat(), &[0]));
    // A second signature, a non-push operation, a truncated push, no signature.
    refused(solved(&[script_sig, &script_sig[1..]].concat(), &[0]));
    refused(solved(&[script_sig, &[0x75][..]].concat(), &[0]));
    refused(solved(&script_sig[..72], &[0]));
    refused(solved(&[0], &[0]));
    // Bytes after the witness stack, or no witness stack at all.
    assert_eq!(solved(script_sig, &[0, 0]).unwrap_err(), "Malformed signet solution");
    assert_eq!(solved(script_sig, &[]).unwrap_err(), "Malformed signet solution");
    // The same signature pushed with OP_PUSHDATA1 is still that signature (no minimal-push rule).
    solved(&[&[0u8, 0x4c][..], &script_sig[1..]].concat(), &[0]).unwrap();
}

#[test]
fn missing_solution_wrong_challenge_and_wrong_proof_are_refused() {
    let p = params();
    let single = block(332_466);
    let tx: bitcoin::Transaction = decode(&single.coinbase, 400_000).unwrap();
    let rebuilt = |tx: &bitcoin::Transaction| {
        let mut h = single.header;
        h.merkle_root = bitcoin::TxMerkleNode::from_byte_array(tx.compute_txid().to_byte_array());
        let raw = hex::encode(bitcoin::consensus::serialize(tx));
        verify_signet_block(&h, &raw, &[], &p)
    };
    rebuilt(&tx).unwrap();

    // Solution removed: the commitment keeps only the four header bytes.
    let commitment = tx.output[1].script_pubkey.as_bytes().to_vec();
    let (stripped, solution) = split_commitment(&commitment).unwrap();
    assert_eq!(solution.len(), 75);
    assert!(stripped.ends_with(&[&[4u8][..], &SIGNET_HEADER[..]].concat()));
    assert!(split_commitment(&stripped).is_none());
    let mut without = tx.clone();
    without.output[1].script_pubkey = bitcoin::ScriptBuf::from_bytes(stripped.clone());
    assert_eq!(rebuilt(&without).unwrap_err(), "Signet block has no solution");
    // No signet push at all, and no witness commitment at all.
    without.output[1].script_pubkey = bitcoin::ScriptBuf::from_bytes(stripped[..38].to_vec());
    assert_eq!(rebuilt(&without).unwrap_err(), "Signet block has no solution");
    without.output.truncate(1);
    assert_eq!(rebuilt(&without).unwrap_err(), "Signet block has no witness commitment");
    // An empty scriptSig and witness: valid only for a trivially true challenge, which is refused.
    let mut empty = tx.clone();
    let mut script = stripped[..38].to_vec();
    script.extend([6, 0xec, 0xc7, 0xda, 0xa2, 0, 0]);
    empty.output[1].script_pubkey = bitcoin::ScriptBuf::from_bytes(script);
    assert!(rebuilt(&empty).unwrap_err().starts_with("Signet solution is not"));

    // A different challenge: the same two keys in the other order, and an unrelated key.
    let b = block(332_644);
    let key = |n: usize| &DEFAULT_SIGNET_CHALLENGE[2 + 68 * n..2 + 68 * (n + 1)];
    let swapped = SignetParams::from_challenge(&format!("51{}{}52ae", key(1), key(0))).unwrap();
    assert_eq!(
        verify_signet_block(&b.header, &b.coinbase, &b.branch, &swapped).unwrap_err(),
        "Invalid signet block signature"
    );
    // The first key alone did not sign this block; the second alone did.
    let first = SignetParams::from_challenge(&format!("51{}51ae", key(0))).unwrap();
    assert!(verify_signet_block(&b.header, &b.coinbase, &b.branch, &first).is_err());
    // Requiring both keys refuses a one-signature solution.
    let both = SignetParams::from_challenge(&format!("52{}{}52ae", key(0), key(1))).unwrap();
    assert!(verify_signet_block(&b.header, &b.coinbase, &b.branch, &both)
        .unwrap_err()
        .starts_with("Signet solution is not"));

    // Proof for another header, a shortened branch, a sibling changed, a non-coinbase transaction.
    let other = block(332_641);
    assert!(verify_signet_block(&other.header, &b.coinbase, &b.branch, &p).is_err());
    assert!(verify_signet_block(&b.header, &b.coinbase, &b.branch[1..], &p).is_err());
    let mut changed = b.branch.clone();
    changed[0] = "00".repeat(32);
    assert!(verify_signet_block(&b.header, &b.coinbase, &changed, &p).is_err());
    assert!(verify_signet_block(&b.header, &b.coinbase, &vec!["00".repeat(32); 33], &p)
        .unwrap_err()
        .starts_with("Oversized"));
    assert!(verify_signet_block(&b.header, &"00".repeat(400_001), &b.branch, &p).is_err());
    let spend = hex::encode(bitcoin::consensus::serialize(
        &signet_txs(&b.header, &b.coinbase, &b.branch, &p).unwrap().to_sign,
    ));
    assert!(verify_signet_block(&b.header, &spend, &b.branch, &p)
        .unwrap_err()
        .starts_with("Signet proof needs"));
}

#[test]
fn the_signature_does_not_cover_the_nonce_so_work_is_checked_separately() {
    let p = params();
    let b = block(332_644);
    let mut h = b.header;
    h.nonce ^= 1;
    verify_signet_block(&h, &b.coinbase, &b.branch, &p).unwrap();
    assert!(check_pow(&h, "signet").is_err());
}

#[test]
fn only_bare_multisig_challenges_are_supported() {
    assert!(signet_params("bitcoin").unwrap().is_none());
    assert!(signet_params("regtest").unwrap().is_none());
    assert!(signet_params("testnet4").is_err());
    let key = &DEFAULT_SIGNET_CHALLENGE[2..70];
    for unsupported in [
        "51".to_string(),                                      // OP_TRUE
        format!("{key}ac"),                                    // pay to public key
        format!("76a914{}88ac", "11".repeat(20)),              // pay to public key hash
        format!("0020{}", "11".repeat(32)),                    // a witness program
        format!("51{key}52ae"),                                // key count does not match
        format!("52{key}51ae"),                                // more signatures than keys
        format!("51{key}51ae00"),                              // trailing data
        format!("5121{}51ae", "11".repeat(33)),                // not a curve point
        format!("51{key}51"),                                  // no OP_CHECKMULTISIG
        "zz".to_string(),
    ] {
        assert!(SignetParams::from_challenge(&unsupported).is_err(), "{unsupported}");
    }
    assert!(SignetParams::from_challenge(&format!("51{key}51ae")).is_ok());
}
