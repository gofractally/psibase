use crate::{serialize_as_str, Pack, Reflect, Unpack};
use custom_error::custom_error;
use ripemd::{Digest, Ripemd160};
use std::{fmt, str::FromStr};

#[cfg(not(target_family = "wasm"))]
use crate::{account_raw, AccountNumber};

custom_error! {
    #[allow(clippy::enum_variant_names)] pub Error

    InvalidKey          = "Invalid key",
    ExpectedPublicKey   = "Expected public key",
    ExpectedPrivateKey  = "Expected private key",
}

#[cfg(not(target_family = "wasm"))]
custom_error! { pub K1Error
    OnlyK1              = "Only K1 keys are fully supported",
    Msg{s:String}       = "{s}",
}

pub type EccPublicKey = [u8; 33];

#[derive(Debug, Clone, Pack, Unpack, Reflect)]
#[fracpack(fracpack_mod = "fracpack")]
#[reflect(psibase_mod = "crate")]
pub enum PublicKeyEnum {
    K1(EccPublicKey),
    R1(EccPublicKey),
}

#[derive(Debug, Clone, Pack, Unpack, Reflect)]
#[fracpack(definition_will_not_change, fracpack_mod = "fracpack")]
#[reflect(psibase_mod = "crate", custom_json = true)]
pub struct PublicKey {
    pub data: PublicKeyEnum,
}

serialize_as_str!(PublicKey, "public key");

impl FromStr for PublicKey {
    type Err = Error;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        if s.len() > 7 && &s[..7] == "PUB_K1_" {
            Ok(PublicKey {
                data: PublicKeyEnum::K1(
                    string_to_key_bytes(&s[7..], "K1").ok_or(Error::InvalidKey)?,
                ),
            })
        } else if s.len() > 7 && &s[..7] == "PUB_R1_" {
            Ok(PublicKey {
                data: PublicKeyEnum::R1(
                    string_to_key_bytes(&s[7..], "R1").ok_or(Error::InvalidKey)?,
                ),
            })
        } else {
            Err(Error::ExpectedPublicKey)
        }
    }
}

impl fmt::Display for PublicKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match &self.data {
            PublicKeyEnum::K1(data) => write!(f, "PUB_K1_{}", key_to_string(data, "K1")),
            PublicKeyEnum::R1(data) => write!(f, "PUB_R1_{}", key_to_string(data, "R1")),
        }
    }
}

#[cfg(not(target_family = "wasm"))]
impl From<&secp256k1::PublicKey> for PublicKey {
    fn from(key: &secp256k1::PublicKey) -> Self {
        Self {
            data: PublicKeyEnum::K1(key.serialize()),
        }
    }
}

pub type EccPrivateKey = [u8; 32];

#[derive(Debug, Clone, Pack, Unpack, Reflect)]
#[fracpack(fracpack_mod = "fracpack")]
#[reflect(psibase_mod = "crate")]
pub enum PrivateKeyEnum {
    K1(EccPrivateKey),
    R1(EccPrivateKey),
}

#[derive(Debug, Clone, Pack, Unpack, Reflect)]
#[fracpack(definition_will_not_change, fracpack_mod = "fracpack")]
#[reflect(psibase_mod = "crate", custom_json = true)]
pub struct PrivateKey {
    pub data: PrivateKeyEnum,
}

impl PrivateKey {
    #[cfg(not(target_family = "wasm"))]
    pub fn into_k1(&self) -> Result<secp256k1::SecretKey, K1Error> {
        match &self.data {
            PrivateKeyEnum::K1(data) => secp256k1::SecretKey::from_slice(data)
                .map_err(|e| K1Error::Msg { s: e.to_string() }),
            PrivateKeyEnum::R1(_) => Err(K1Error::OnlyK1),
        }
    }
}

serialize_as_str!(PrivateKey, "private key");

impl FromStr for PrivateKey {
    type Err = Error;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        if s.len() > 7 && &s[..7] == "PVT_K1_" {
            Ok(PrivateKey {
                data: PrivateKeyEnum::K1(
                    string_to_key_bytes(&s[7..], "K1").ok_or(Error::InvalidKey)?,
                ),
            })
        } else if s.len() > 7 && &s[..7] == "PVT_R1_" {
            Ok(PrivateKey {
                data: PrivateKeyEnum::R1(
                    string_to_key_bytes(&s[7..], "R1").ok_or(Error::InvalidKey)?,
                ),
            })
        } else {
            Err(Error::ExpectedPrivateKey)
        }
    }
}

impl fmt::Display for PrivateKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match &self.data {
            PrivateKeyEnum::K1(data) => write!(f, "PVT_K1_{}", key_to_string(data, "K1")),
            PrivateKeyEnum::R1(data) => write!(f, "PVT_R1_{}", key_to_string(data, "R1")),
        }
    }
}

#[cfg(not(target_family = "wasm"))]
impl From<&secp256k1::SecretKey> for PrivateKey {
    fn from(key: &secp256k1::SecretKey) -> Self {
        Self {
            data: PrivateKeyEnum::K1(key.secret_bytes()),
        }
    }
}

pub type EccSignature = [u8; 64];

#[derive(Debug, Clone, Pack, Unpack, Reflect)]
#[fracpack(fracpack_mod = "fracpack")]
#[reflect(psibase_mod = "crate")]
pub enum SignatureEnum {
    K1(EccSignature),
    R1(EccSignature),
}

#[derive(Debug, Clone, Pack, Unpack, Reflect)]
#[fracpack(definition_will_not_change, fracpack_mod = "fracpack")]
#[reflect(psibase_mod = "crate", custom_json = true)]
pub struct Signature {
    pub data: SignatureEnum,
}

#[cfg(not(target_family = "wasm"))]
impl From<&secp256k1::ecdsa::Signature> for Signature {
    fn from(signature: &secp256k1::ecdsa::Signature) -> Self {
        Self {
            data: SignatureEnum::K1(signature.serialize_compact()),
        }
    }
}

#[cfg(not(target_family = "wasm"))]
impl From<secp256k1::ecdsa::Signature> for Signature {
    fn from(signature: secp256k1::ecdsa::Signature) -> Self {
        Self {
            data: SignatureEnum::K1(signature.serialize_compact()),
        }
    }
}

const BASE58_CHARS: &[u8] = b"123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

const BASE58_MAP: [u8; 256] = [
    0x3a, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10, 0xff, 0x11, 0x12, 0x13, 0x14, 0x15, 0xff,
    0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f, 0x20, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x2b, 0xff, 0x2c, 0x2d, 0x2e,
    0x2f, 0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
];

fn base58_to_binary(s: &str) -> Option<Vec<u8>> {
    let mut result = Vec::new();
    for src_digit in s.bytes() {
        let mut carry = BASE58_MAP[src_digit as usize] as u16;
        if carry & 0x80 != 0 {
            return None;
        }
        for result_byte in &mut result {
            let x = *result_byte as u16 * 58 + carry;
            *result_byte = x as u8;
            carry = x >> 8;
        }
        if carry != 0 {
            result.push(carry as u8);
        }
    }
    for src_digit in s.bytes() {
        if src_digit == b'1' {
            result.push(0);
        } else {
            break;
        }
    }
    result.reverse();
    Some(result)
}

fn binary_to_base58(bin: &[u8]) -> String {
    let mut result: Vec<u8> = Vec::new();
    for byte in bin {
        let mut carry = *byte;
        for result_digit in &mut result {
            let x = ((BASE58_MAP[*result_digit as usize] as u16) << 8) + carry as u16;
            *result_digit = BASE58_CHARS[(x % 58) as usize];
            carry = (x / 58) as u8;
        }
        while carry != 0 {
            result.push(BASE58_CHARS[(carry % 58) as usize]);
            carry /= 58;
        }
    }
    for byte in bin {
        if *byte != 0 {
            break;
        }
        result.push(b'1');
    }
    result.reverse();
    String::from_utf8(result).unwrap()
}

fn digest_suffix_ripemd160(data: &[u8], suffix: &[u8]) -> [u8; 20] {
    let mut hasher = Ripemd160::new();
    hasher.update(data);
    hasher.update(suffix);
    hasher.finalize().into()
}

fn string_to_key_bytes<const SIZE: usize>(s: &str, suffix: &str) -> Option<[u8; SIZE]> {
    let v = base58_to_binary(s)?;
    if v.len() != SIZE + 4 {
        return None;
    }
    let ripe_digest = digest_suffix_ripemd160(&v[..v.len() - 4], suffix.as_bytes());
    if ripe_digest[0..4] != v[v.len() - 4..] {
        return None;
    }
    let mut result = [0; SIZE];
    result.copy_from_slice(&v[..v.len() - 4]);
    Some(result)
}

fn key_to_string(bytes: &[u8], suffix: &str) -> String {
    let ripe_digest = digest_suffix_ripemd160(bytes, suffix.as_bytes());
    let mut whole = bytes.to_vec();
    let l = whole.len();
    whole.resize(l + 4, 0);
    whole[l..].copy_from_slice(&ripe_digest[..4]);
    binary_to_base58(&whole)
}

#[cfg(not(target_family = "wasm"))]
pub fn sign_transaction(
    mut trx: crate::Transaction,
    keys: &[PrivateKey],
) -> Result<crate::SignedTransaction, K1Error> {
    let keys = keys
        .iter()
        .map(|k| k.into_k1())
        .collect::<Result<Vec<_>, _>>()?;
    trx.claims = keys
        .iter()
        .map(|k| crate::Claim {
            service: AccountNumber::new(account_raw!("verifyec-sys")),
            rawData: fracpack::Pack::packed(&PublicKey::from(
                &secp256k1::PublicKey::from_secret_key(secp256k1::SECP256K1, k),
            ))
            .into(),
        })
        .collect();
    let transaction = fracpack::Pack::packed(&trx);
    let digest =
        secp256k1::Message::from_hashed_data::<secp256k1::hashes::sha256::Hash>(&transaction);
    let proofs = keys
        .iter()
        .map(|k| {
            fracpack::Pack::packed(&Signature::from(
                secp256k1::SECP256K1.sign_ecdsa(&digest, k),
            ))
            .into()
        })
        .collect();
    Ok(crate::SignedTransaction {
        transaction: transaction.into(),
        proofs,
    })
}
