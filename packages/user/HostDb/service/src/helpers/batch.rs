use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use psibase::*;
use serde::Deserialize;
use std::str::FromStr;

use super::constants::{KEY_LEN, MAX_VALUE_LEN};
use super::encoding::decode_fixed_hex;

#[derive(Clone, Copy, PartialEq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Duration {
    Persistent,
    Session,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct BatchBody {
    ops: Vec<BatchOp>,
}

/// Ciphertext observed by GET: absent, or the SHA-256 of the value returned.
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum ReadExpect {
    Absent,
    Hash(Checksum256),
}

/// Read-time precondition for one batch op.
/// Missing `expected` is unconditional. Null means the GET was absent.
/// A hex string is the SHA-256 of the ciphertext that GET returned.
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) enum Precondition {
    #[default]
    Unconditional,
    Read(ReadExpect),
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct BatchOp {
    duration: Duration,
    key: String,
    value: Option<String>,
    #[serde(default, deserialize_with = "deserialize_precondition")]
    expected: Precondition,
}

pub(crate) struct Change {
    pub(crate) duration: Duration,
    pub(crate) key: Vec<u8>,
    pub(crate) value: Option<Vec<u8>>,
    pub(crate) expected: Precondition,
}

/// Returns `None` when the body is not valid JSON, an op has a bad
/// key/value/expected field, or a value exceeds `MAX_VALUE_LEN`.
pub(crate) fn parse_batch(body: &[u8]) -> Option<Vec<Change>> {
    let body: BatchBody = serde_json::from_slice(body).ok()?;
    let mut changes = Vec::with_capacity(body.ops.len());
    for op in body.ops {
        let key = decode_fixed_hex::<KEY_LEN>(&op.key)?;
        let value = match op.value {
            None => None,
            Some(value) => {
                let value = URL_SAFE_NO_PAD.decode(value).ok()?;
                if value.len() > MAX_VALUE_LEN {
                    return None;
                }
                Some(value)
            }
        };
        changes.push(Change {
            duration: op.duration,
            key,
            value,
            expected: op.expected,
        });
    }
    Some(changes)
}

fn deserialize_precondition<'de, D>(deserializer: D) -> Result<Precondition, D::Error>
where
    D: serde::Deserializer<'de>,
{
    match Option::<String>::deserialize(deserializer)? {
        None => Ok(Precondition::Read(ReadExpect::Absent)),
        Some(hex) => Checksum256::from_str(&hex)
            .map(|hash| Precondition::Read(ReadExpect::Hash(hash)))
            .map_err(|_| serde::de::Error::custom("expected must be a SHA-256 hex digest")),
    }
}

/// 409 when the read-time expectation does not describe `stored`.
pub(crate) fn check_precondition(stored: Option<&[u8]>, expected: &ReadExpect) -> Result<(), u16> {
    let matches = match expected {
        ReadExpect::Absent => stored.is_none(),
        ReadExpect::Hash(hash) => stored.is_some_and(|value| sha256(value) == *hash),
    };
    if matches {
        Ok(())
    } else {
        Err(409)
    }
}
