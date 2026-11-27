//! A secp256k1 private key as one line of text: Bitcoin's wallet import
//! format (WIF), the string that Bitcoin tools read and write.
//!
//! ```text
//! base58( version || secret[32] || [0x01] || check[4] )
//! ```
//!
//! - version is 0x80 (mainnet) or 0xEF (Bitcoin's test networks). The key is
//!   the same number either way; the byte only says where the string came
//!   from.
//! - A trailing 0x01 says that the public key is used in its compressed form
//!   (strings that start with K or L; c on a test network). Without it the
//!   public key is the uncompressed point (5; 9 on a test network).
//! - check is the first four bytes of SHA-256(SHA-256(everything before it)).
//!
//! This mirrors `psibase/wif.hpp`, which is the definition; the two must
//! agree, and both are tested against
//! `libraries/psibase/common/tests/wif-vectors.json`.
//!
//! P-256 keys have no such form; they stay PEM.

use sha2::{Digest, Sha256};

const ALPHABET: &[u8; 58] = b"123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/// version, secret, flag, check
const MAX_BYTES: usize = 1 + 32 + 1 + 4;
/// No string of 37 or 38 bytes is longer than this in base58
const MAX_TEXT: usize = 52;

/// The order of the secp256k1 group, big-endian
const ORDER: [u8; 32] = [
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xfe,
    0xba, 0xae, 0xdc, 0xe6, 0xaf, 0x48, 0xa0, 0x3b, 0xbf, 0xd2, 0x5e, 0x8c, 0xd0, 0x36, 0x41, 0x41,
];

/// The version byte of a WIF string
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum WifNetwork {
    Mainnet = 0x80,
    Testnet = 0xef,
}

/// What a WIF string holds
#[derive(Clone, PartialEq, Eq)]
pub struct WifKey {
    /// The private key, big-endian. 0 < secret < the group order.
    pub secret: [u8; 32],
    /// Whether the string asks for the compressed public key
    pub compressed: bool,
    pub network: WifNetwork,
}

// Not derived: the key must not end up in a log.
impl std::fmt::Debug for WifKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("WifKey")
            .field("compressed", &self.compressed)
            .field("network", &self.network)
            .finish_non_exhaustive()
    }
}

impl Drop for WifKey {
    fn drop(&mut self) {
        self.secret.fill(0);
    }
}

/// The first rule that a string breaks, in the order they are checked
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WifError {
    /// A character outside the base58 alphabet, including white space
    /// anywhere but the ends
    BadCharacter,
    /// Not 37 or 38 bytes
    BadLength,
    /// The check bytes do not match: the string was mistyped
    BadChecksum,
    /// A version byte other than 0x80 or 0xEF
    BadVersion,
    /// A 34th payload byte other than 0x01
    BadFlag,
    /// The key is 0 or is not below the secp256k1 group order
    BadSecret,
}

impl WifError {
    /// "bad-character", "bad-length", "bad-checksum", "bad-version",
    /// "bad-flag", "bad-secret": the same names in every language
    pub fn name(self) -> &'static str {
        match self {
            WifError::BadCharacter => "bad-character",
            WifError::BadLength => "bad-length",
            WifError::BadChecksum => "bad-checksum",
            WifError::BadVersion => "bad-version",
            WifError::BadFlag => "bad-flag",
            WifError::BadSecret => "bad-secret",
        }
    }

    /// A sentence for the person who supplied the key
    pub fn message(self) -> &'static str {
        match self {
            WifError::BadCharacter => "private key (WIF): contains a character that is not base58",
            WifError::BadLength => "private key (WIF): wrong length",
            WifError::BadChecksum => "private key (WIF): check digits do not match",
            WifError::BadVersion => {
                "private key (WIF): not a Bitcoin mainnet or testnet private key"
            }
            WifError::BadFlag => "private key (WIF): malformed compression flag",
            WifError::BadSecret => "private key (WIF): not a valid secp256k1 key",
        }
    }
}

impl std::fmt::Display for WifError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.message())
    }
}

impl std::error::Error for WifError {}

fn is_space(ch: char) -> bool {
    matches!(ch, ' ' | '\t' | '\r' | '\n')
}

fn digit(ch: u8) -> Option<u8> {
    ALPHABET.iter().position(|c| *c == ch).map(|i| i as u8)
}

/// 0 < secret < order
fn valid_secret(secret: &[u8]) -> bool {
    secret.iter().any(|b| *b != 0) && secret < &ORDER[..]
}

fn check_bytes(payload: &[u8]) -> [u8; 4] {
    let digest = Sha256::digest(Sha256::digest(payload));
    [digest[0], digest[1], digest[2], digest[3]]
}

/// The WIF string of a private key. The usual form is compressed and
/// mainnet: `wif_encode(&secret, true, WifNetwork::Mainnet)`. Fails with
/// `BadSecret` if the key is 0 or is not below the group order.
pub fn wif_encode(
    secret: &[u8; 32],
    compressed: bool,
    network: WifNetwork,
) -> Result<String, WifError> {
    if !valid_secret(secret) {
        return Err(WifError::BadSecret);
    }
    let mut bytes = [0u8; MAX_BYTES];
    let mut size = 0;
    bytes[size] = network as u8;
    size += 1;
    bytes[size..size + 32].copy_from_slice(secret);
    size += 32;
    if compressed {
        bytes[size] = 0x01;
        size += 1;
    }
    let sum = check_bytes(&bytes[..size]);
    bytes[size..size + 4].copy_from_slice(&sum);
    size += 4;

    // Repeated division by 58; digits come out least significant first
    let mut digits = Vec::with_capacity(MAX_TEXT);
    let mut start = 0;
    while start < size {
        let mut remainder = 0u32;
        for b in bytes[start..size].iter_mut() {
            let value = remainder * 256 + *b as u32;
            *b = (value / 58) as u8;
            remainder = value % 58;
        }
        digits.push(ALPHABET[remainder as usize]);
        while start < size && bytes[start] == 0 {
            start += 1;
        }
    }
    // The version byte is never zero, so there are no leading zeros to write
    digits.reverse();
    bytes.fill(0);
    Ok(String::from_utf8(digits).expect("base58 is ASCII"))
}

/// Reads a WIF string. ASCII white space (space, tab, CR, LF) is ignored at
/// the ends and is an error anywhere else.
pub fn wif_decode(text: &str) -> Result<WifKey, WifError> {
    let text = text.trim_matches(is_space).as_bytes();
    if text.iter().any(|ch| digit(*ch).is_none()) {
        return Err(WifError::BadCharacter);
    }
    if text.is_empty() || text.len() > MAX_TEXT {
        return Err(WifError::BadLength);
    }

    // The number, big-endian, right-aligned. 52 base58 digits are below
    // 2^305 and this holds 312 bits.
    let mut number = [0u8; MAX_BYTES + 1];
    for ch in text {
        let mut carry = digit(*ch).unwrap() as u32;
        for b in number.iter_mut().rev() {
            carry += *b as u32 * 58;
            *b = carry as u8;
            carry >>= 8;
        }
    }
    // The bytes are the number without its leading zeros, preceded by one
    // zero byte for each leading '1' of the text
    let first = number.iter().position(|b| *b != 0).unwrap_or(number.len());
    let zeros = text.iter().take_while(|ch| **ch == b'1').count();
    let size = zeros + (number.len() - first);

    let result = if size != MAX_BYTES && size != MAX_BYTES - 1 {
        Err(WifError::BadLength)
    } else {
        let bytes = &number[number.len() - size..];
        let (payload, check) = bytes.split_at(size - 4);
        if check_bytes(payload) != *check {
            Err(WifError::BadChecksum)
        } else if payload[0] != 0x80 && payload[0] != 0xef {
            Err(WifError::BadVersion)
        } else if payload.len() == 34 && payload[33] != 0x01 {
            Err(WifError::BadFlag)
        } else if !valid_secret(&payload[1..33]) {
            Err(WifError::BadSecret)
        } else {
            let mut secret = [0u8; 32];
            secret.copy_from_slice(&payload[1..33]);
            Ok(WifKey {
                secret,
                compressed: payload.len() == 34,
                network: if payload[0] == 0x80 {
                    WifNetwork::Mainnet
                } else {
                    WifNetwork::Testnet
                },
            })
        }
    };
    number.fill(0);
    result
}

/// Whether the text has the shape of a WIF string: 51 or 52 base58
/// characters that start with 5, K, L, 9 or c, with optional white space
/// around them. Cheap, and says nothing about whether the string is valid;
/// it is for telling a key from a file name or a PEM document.
pub fn looks_like_wif(text: &str) -> bool {
    let text = text.trim_matches(is_space).as_bytes();
    (text.len() == 51 || text.len() == 52)
        && b"5KL9c".contains(&text[0])
        && text.iter().all(|ch| digit(*ch).is_some())
}
