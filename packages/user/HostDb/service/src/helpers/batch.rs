use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use psibase::*;
use serde::Deserialize;

use super::constants::{KEY_LEN, MAX_VALUE_LEN};

#[derive(Clone, Copy, PartialEq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Duration {
    Persistent,
    Session,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct BatchBody {
    ops: Vec<Change>,
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

impl<'de> Deserialize<'de> for Precondition {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Ok(match Option::<Checksum256>::deserialize(deserializer)? {
            None => Precondition::Read(ReadExpect::Absent),
            Some(hash) => Precondition::Read(ReadExpect::Hash(hash)),
        })
    }
}

/// Standard base64 in JSON. Longer than `MAX_VALUE_LEN` is rejected.
struct Base64(Vec<u8>);

impl<'de> Deserialize<'de> for Base64 {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct Visitor;

        impl serde::de::Visitor<'_> for Visitor {
            type Value = Base64;

            fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
                formatter.write_str("standard base64")
            }

            fn visit_str<E: serde::de::Error>(self, value: &str) -> Result<Base64, E> {
                let bytes = STANDARD.decode(value).map_err(E::custom)?;
                if bytes.len() > MAX_VALUE_LEN {
                    return Err(E::custom("value exceeds maximum length"));
                }
                Ok(Base64(bytes))
            }
        }

        deserializer.deserialize_str(Visitor)
    }
}

// A present field is `Some`, so omission stays distinct from JSON null.
fn deserialize_omitted_vs_null<'de, D>(
    deserializer: D,
) -> Result<Option<Option<Base64>>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Ok(Some(Option::<Base64>::deserialize(deserializer)?))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Change {
    pub(crate) duration: Duration,
    key: Hex<[u8; KEY_LEN]>,
    #[serde(default, deserialize_with = "deserialize_omitted_vs_null")]
    value: Option<Option<Base64>>,
    #[serde(default)]
    pub(crate) expected: Precondition,
}

/// The write half of a batch op. Absent `value` is not a write.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum Write<'a> {
    Delete,
    Put(&'a [u8]),
}

impl Change {
    pub(crate) fn key(&self) -> &[u8] {
        self.key.as_slice()
    }

    /// `None` checks `expected` and does not write.
    pub(crate) fn write(&self) -> Option<Write<'_>> {
        match &self.value {
            None => None,
            Some(None) => Some(Write::Delete),
            Some(Some(value)) => Some(Write::Put(value.0.as_slice())),
        }
    }

    /// 400 unless this check-only op names the read it checks.
    pub(crate) fn require_read(&self) -> Result<(), u16> {
        match &self.expected {
            Precondition::Read(_) => Ok(()),
            Precondition::Unconditional => Err(400),
        }
    }
}

/// Returns `None` when the body is not valid JSON, an op has a bad
/// key/value/expected field, or a value exceeds `MAX_VALUE_LEN`.
pub(crate) fn parse_batch(body: &[u8]) -> Option<Vec<Change>> {
    serde_json::from_slice::<BatchBody>(body)
        .ok()
        .map(|body| body.ops)
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
