//! Bitcoin's wallet import format as `psibase::wif` implements it, against
//! `libraries/psibase/common/tests/wif-vectors.json`: the file that the C++
//! definition (`psibase/wif.hpp`, tested by `wif.cpp` beside the vectors),
//! common-lib's `wif.ts` and `psinode.py` are tested against too.
//!
//! Also here: what the command line makes of such a key, as a signer
//! (`--sign`) and as a public key (`-k`).
#![cfg(not(target_family = "wasm"))]

use psibase::*;
use std::str::FromStr;

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

fn unhex(text: &str) -> Vec<u8> {
    (0..text.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&text[i..i + 2], 16).unwrap())
        .collect()
}

fn vectors() -> serde_json::Value {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../libraries/psibase/common/tests/wif-vectors.json"
    );
    serde_json::from_str(&std::fs::read_to_string(path).expect(path)).unwrap()
}

fn text<'a>(v: &'a serde_json::Value, name: &str) -> &'a str {
    v[name].as_str().unwrap()
}

fn public_key(secret: &[u8; 32], compressed: bool) -> Vec<u8> {
    let key = secp256k1::SecretKey::from_slice(secret).unwrap();
    let public = secp256k1::PublicKey::from_secret_key(secp256k1::SECP256K1, &key);
    if compressed {
        public.serialize().to_vec()
    } else {
        public.serialize_uncompressed().to_vec()
    }
}

/// SubjectPublicKeyInfo of a secp256k1 point
fn spki(point: &[u8]) -> Vec<u8> {
    let algorithm = unhex("301006072a8648ce3d020106052b8104000a");
    let mut result = vec![0x30, (algorithm.len() + 3 + point.len()) as u8];
    result.extend_from_slice(&algorithm);
    result.extend_from_slice(&[0x03, (point.len() + 1) as u8, 0x00]);
    result.extend_from_slice(point);
    result
}

#[test]
fn valid_vectors() {
    let vectors = vectors();
    let valid = vectors["valid"].as_array().unwrap();
    assert!(valid.len() >= 12);
    for v in valid {
        let name = text(v, "name");
        let wif = text(v, "wif");
        let secret: [u8; 32] = unhex(text(v, "secret")).try_into().unwrap();
        let compressed = v["compressed"].as_bool().unwrap();
        let network = match text(v, "network") {
            "mainnet" => WifNetwork::Mainnet,
            "testnet" => WifNetwork::Testnet,
            other => panic!("{name}: network {other}"),
        };

        assert_eq!(wif_encode(&secret, compressed, network).unwrap(), wif, "{name}");
        assert!(looks_like_wif(wif), "{name}");
        let key = wif_decode(wif).unwrap_or_else(|e| panic!("{name}: {e}"));
        assert_eq!(key.secret, secret, "{name}");
        assert_eq!(key.compressed, compressed, "{name}");
        assert_eq!(key.network, network, "{name}");

        let compressed_key = public_key(&key.secret, true);
        let uncompressed_key = public_key(&key.secret, false);
        assert_eq!(hex(&compressed_key), text(v, "publicKeyCompressed"), "{name}");
        assert_eq!(hex(&uncompressed_key), text(v, "publicKeyUncompressed"), "{name}");

        // The command line: the claim of a signer, and the public key that
        // -k stores, name the point in the form the string asks for.
        let expected = spki(if compressed {
            &compressed_key
        } else {
            &uncompressed_key
        });
        let signer = AnyPrivateKey::from_str(wif).unwrap();
        assert_eq!(signer.claim().rawData, expected, "{name}");
        assert_eq!(signer.claim().service, VERIFY_K1, "{name}");
        let public = AnyPublicKey::from_str(wif).unwrap();
        assert_eq!(public.key.rawData, expected, "{name}");
        assert_eq!(public.key.service, VERIFY_K1, "{name}");
    }
}

#[test]
fn whitespace_at_the_ends() {
    let vectors = vectors();
    let cases = vectors["whitespace"].as_array().unwrap();
    assert!(!cases.is_empty());
    for v in cases {
        let name = text(v, "name");
        assert!(looks_like_wif(text(v, "text")), "{name}");
        assert_eq!(
            wif_decode(text(v, "text")),
            wif_decode(text(v, "wif")),
            "{name}"
        );
        assert!(wif_decode(text(v, "text")).is_ok(), "{name}");
    }
}

#[test]
fn invalid_vectors() {
    let vectors = vectors();
    let invalid = vectors["invalid"].as_array().unwrap();
    assert!(invalid.len() >= 20);
    for v in invalid {
        let name = text(v, "name");
        let error = wif_decode(text(v, "text")).expect_err(name);
        assert_eq!(error.name(), text(v, "error"), "{name}");
        assert!(!error.message().is_empty());
        assert_eq!(
            looks_like_wif(text(v, "text")),
            v["looksLikeWif"].as_bool().unwrap(),
            "{name}"
        );
        // A string that has the shape of a key and is wrong is refused as
        // a key; it is not taken for a file name.
        if looks_like_wif(text(v, "text")) {
            let message = AnyPrivateKey::from_str(text(v, "text"))
                .unwrap_err()
                .to_string();
            assert_eq!(message, error.message(), "{name}");
            assert!(AnyPublicKey::from_str(text(v, "text")).is_err(), "{name}");
        }
    }
}

#[test]
fn encode_refuses_keys_outside_the_group() {
    let order = unhex("fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141");
    assert_eq!(
        wif_encode(&[0; 32], true, WifNetwork::Mainnet),
        Err(WifError::BadSecret)
    );
    assert_eq!(
        wif_encode(&order.try_into().unwrap(), true, WifNetwork::Mainnet),
        Err(WifError::BadSecret)
    );
}

#[test]
fn debug_does_not_print_the_key() {
    let key = wif_decode("KwdMAjGmerYanjeui5SHS7JkmpZvVipYvB2LJGU1ZxJwYvP98617").unwrap();
    let shown = format!("{:?}", key);
    assert!(!shown.contains("0c28") && !shown.contains("12, 40"), "{shown}");
}

/// A file that holds the string is the same key as the string.
#[test]
fn key_file() {
    let wif = "KwdMAjGmerYanjeui5SHS7JkmpZvVipYvB2LJGU1ZxJwYvP98617";
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("alice.key");
    std::fs::write(&path, format!("{wif}\n")).unwrap();
    let path = path.to_str().unwrap();
    assert_eq!(
        AnyPrivateKey::from_str(path).unwrap().claim().rawData,
        AnyPrivateKey::from_str(wif).unwrap().claim().rawData
    );
    assert_eq!(
        AnyPublicKey::from_str(path).unwrap().key.rawData,
        AnyPublicKey::from_str(wif).unwrap().key.rawData
    );
    assert_eq!(load_k1_private_key(path).unwrap(), wif_decode(wif).unwrap());
}

/// What `psibase key generate` and `psibase key show` are made of: a new
/// key is written as WIF by default, and the PEM form of a key signs for
/// the same public key as its WIF form, in both forms of the point.
#[test]
fn generated_key_and_pem_form() {
    let key = generate_k1_private_key();
    assert!(key.compressed);
    assert_eq!(key.network, WifNetwork::Mainnet);
    let wif = wif_encode(&key.secret, key.compressed, key.network).unwrap();
    assert!(wif.starts_with('K') || wif.starts_with('L'));
    assert_eq!(wif.len(), 52);

    let dir = tempfile::tempdir().unwrap();
    for compressed in [true, false] {
        let key = WifKey {
            secret: key.secret,
            compressed,
            network: WifNetwork::Mainnet,
        };
        let wif = wif_encode(&key.secret, compressed, WifNetwork::Mainnet).unwrap();
        assert_eq!(wif.starts_with('5'), !compressed);
        let path = dir.path().join(format!("key-{compressed}.pem"));
        let pem = k1_private_key_pem(&key).unwrap();
        assert!(pem.starts_with("-----BEGIN PRIVATE KEY-----\n"));
        std::fs::write(&path, &pem).unwrap();
        let path = path.to_str().unwrap();

        let from_pem = AnyPrivateKey::from_str(path).unwrap();
        let from_wif = AnyPrivateKey::from_str(&wif).unwrap();
        assert_eq!(from_pem.claim().rawData, from_wif.claim().rawData);
        assert_eq!(
            from_wif.claim().rawData,
            spki(&public_key(&key.secret, compressed))
        );
        // and back: the PEM file gives the same WIF string
        assert_eq!(load_k1_private_key(path).unwrap(), key);

        let public = public_key_pem(&from_wif.claim().rawData);
        let public_path = dir.path().join(format!("key-{compressed}.pub"));
        std::fs::write(&public_path, public).unwrap();
        assert_eq!(
            AnyPublicKey::from_str(public_path.to_str().unwrap())
                .unwrap()
                .key
                .rawData,
            from_wif.claim().rawData
        );
    }
}

/// The same key in its two WIF forms signs for two different public keys
/// as far as the chain is concerned: it compares the claim with the stored
/// key byte for byte. Both signatures verify against the one point.
#[test]
fn the_two_forms_claim_different_keys() {
    let secret: [u8; 32] =
        unhex("0c28fca386c7a227600b2fe50b7cae11ec86d3bf1fbe471be89827e19d72aa1d")
            .try_into()
            .unwrap();
    let compressed = AnyPrivateKey::from_str("KwdMAjGmerYanjeui5SHS7JkmpZvVipYvB2LJGU1ZxJwYvP98617")
        .unwrap()
        .claim();
    let uncompressed =
        AnyPrivateKey::from_str("5HueCGU8rMjxEXxiPuD5BDku4MkFqeZyd4dZ1jvhTVqvbTLvyTJ")
            .unwrap()
            .claim();
    assert_ne!(compressed.rawData, uncompressed.rawData);
    assert_eq!(compressed.rawData.len(), 23 + 33);
    assert_eq!(uncompressed.rawData.len(), 23 + 65);
    assert_eq!(
        secp256k1::PublicKey::from_slice(&compressed.rawData[23..]).unwrap(),
        secp256k1::PublicKey::from_slice(&uncompressed.rawData[23..]).unwrap()
    );
    assert_eq!(compressed.rawData[23..], public_key(&secret, true)[..]);
}
