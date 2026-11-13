use std::str::FromStr;

use psibase::HttpStatus;
use psibase::HttpStatus::BadRequest;
use psibase::*;
use serde::Deserialize;

use crate::base64::Base64;
use crate::policy::KEY_LEN;

pub(crate) fn decode_fixed_hex<const N: usize>(input: &str) -> Option<Vec<u8>> {
    Hex::<[u8; N]>::from_str(input)
        .ok()
        .map(|hex| hex.0.to_vec())
}

#[derive(Clone, Copy, PartialEq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Duration {
    Persistent,
    Session,
}

#[cfg(test)]
impl std::fmt::Display for Duration {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Duration::Persistent => "persistent",
            Duration::Session => "session",
        })
    }
}

/// Ciphertext observed by GET: absent, or the SHA-256 of the value returned.
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum ReadExpect {
    Absent,
    Hash(Checksum256),
}

impl ReadExpect {
    pub(crate) fn require_matches(&self, stored: Option<&[u8]>) -> Result<(), HttpStatus> {
        let ok = match self {
            ReadExpect::Absent => stored.is_none(),
            ReadExpect::Hash(hash) => stored.is_some_and(|value| sha256(value) == *hash),
        };
        if ok {
            Ok(())
        } else {
            Err(HttpStatus::Conflict)
        }
    }
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

/// Batch op `value` field: omitted (check), JSON `null` (remove), or base64 (store).
#[derive(Default)]
#[cfg_attr(test, derive(Debug, PartialEq))]
pub(crate) enum StoredValueOp {
    #[default]
    Check,
    Remove,
    Store(Base64),
}

impl<'de> Deserialize<'de> for StoredValueOp {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Ok(match Option::<Base64>::deserialize(deserializer)? {
            None => StoredValueOp::Remove,
            Some(value) => StoredValueOp::Store(value),
        })
    }
}

pub(crate) struct BatchOp {
    pub(crate) duration: Duration,
    key: Vec<u8>,
    pub(crate) value: StoredValueOp,
    pub(crate) expected: Precondition,
}

impl BatchOp {
    pub(crate) fn new(
        duration: Duration,
        key: Vec<u8>,
        value: StoredValueOp,
        expected: Precondition,
    ) -> Self {
        Self {
            duration,
            key,
            value,
            expected,
        }
    }

    pub(crate) fn key(&self) -> &[u8] {
        &self.key
    }

    /// 400 unless this check-only op names the read it checks.
    pub(crate) fn require_read(&self) -> Result<(), HttpStatus> {
        match &self.expected {
            Precondition::Read(_) => Ok(()),
            Precondition::Unconditional => Err(BadRequest),
        }
    }
}

pub(crate) fn batch_ops_from_body(body: &[u8]) -> Option<Vec<BatchOp>> {
    serde_json::from_slice::<BatchBodyWire>(body)
        .ok()
        .map(|body| body.ops)?
        .into_iter()
        .map(validated_batch_op)
        .collect()
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct BatchBodyWire {
    ops: Vec<BatchOpWire>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct BatchOpWire {
    duration: Duration,
    key: String,
    #[serde(default)]
    value: StoredValueOp,
    #[serde(default)]
    expected: Precondition,
}

fn validated_batch_op(op: BatchOpWire) -> Option<BatchOp> {
    let key = decode_fixed_hex::<KEY_LEN>(&op.key)?;
    Some(BatchOp::new(op.duration, key, op.value, op.expected))
}

#[cfg(test)]
mod tests {
    use super::{batch_ops_from_body, BatchOp, Duration, Precondition, ReadExpect, StoredValueOp};
    use crate::base64::Base64;
    use crate::policy::{KEY_LEN, MAX_VALUE_LEN};
    use psibase::*;

    fn lowercase_hex(bytes: &[u8]) -> String {
        Hex(bytes).to_string().to_ascii_lowercase()
    }

    fn sample_key_hex() -> String {
        lowercase_hex(&[0xab; KEY_LEN])
    }

    fn decode_batch(body: &[u8]) -> Option<Vec<BatchOp>> {
        batch_ops_from_body(body)
    }

    #[test]
    fn concurrency_races() {
        let stored = b"ciphertext-v2";
        // Values updated concurrently, so the get on device 1 is out of date by the time it calls set.
        assert_eq!(
            ReadExpect::Hash(sha256(b"ciphertext-v1")).require_matches(Some(stored)),
            Err(HttpStatus::Conflict)
        );
        // Nothing else wrote the key between get and set, so the hash still matches.
        assert_eq!(
            ReadExpect::Hash(sha256(stored)).require_matches(Some(stored)),
            Ok(())
        );
        // Key deleted concurrently, so the value from device 1's get is gone by the time it calls set.
        assert_eq!(
            ReadExpect::Hash(sha256(stored)).require_matches(None),
            Err(HttpStatus::Conflict)
        );
        // Another device stored the key after device 1's get returned 404, so the absence is stale at set.
        assert_eq!(
            ReadExpect::Absent.require_matches(Some(stored)),
            Err(HttpStatus::Conflict)
        );
        // Get returned 404 and the key is still absent when device 1 calls set.
        assert_eq!(ReadExpect::Absent.require_matches(None), Ok(()));
    }

    /// `None` means the body is rejected. Otherwise the batch is one op with this value and precondition.
    fn assert_batch(body: &str, expected: Option<(StoredValueOp, Precondition)>) {
        let ops = decode_batch(body.as_bytes());
        let Some((value, precondition)) = expected else {
            assert!(ops.is_none());
            return;
        };
        let ops = ops.unwrap();
        assert_eq!(ops.len(), 1);
        let checks_read = matches!(value, StoredValueOp::Check);
        assert_eq!(ops[0].value, value);
        assert_eq!(ops[0].expected, precondition);
        if checks_read {
            assert_eq!(ops[0].require_read(), Ok(()));
        }
    }

    #[test]
    fn batch_parsing() {
        use base64::engine::general_purpose::STANDARD;
        use base64::Engine;

        let key = sample_key_hex();
        let ciphertext_hash = sha256(b"ciphertext");
        let hash = lowercase_hex(&ciphertext_hash.0);
        let value = "+w==";
        let persistent = Duration::Persistent;
        let session = Duration::Session;
        assert_batch(
            &format!(
                r#"{{"ops":[{{"duration":"{persistent}","key":"{key}","value":"{value}","expected":"{hash}"}}]}}"#
            ),
            Some((
                StoredValueOp::Store(Base64(vec![0xfb])),
                Precondition::Read(ReadExpect::Hash(ciphertext_hash.clone())),
            )),
        );

        assert_batch(
            &format!(
                r#"{{"ops":[{{"duration":"{session}","key":"{key}","value":null,"expected":null}}]}}"#
            ),
            Some((
                StoredValueOp::Remove,
                Precondition::Read(ReadExpect::Absent),
            )),
        );

        assert_batch(
            &format!(
                r#"{{"ops":[{{"duration":"{persistent}","key":"{key}","value":"{value}"}}]}}"#
            ),
            Some((
                StoredValueOp::Store(Base64(vec![0xfb])),
                Precondition::Unconditional,
            )),
        );

        assert_batch(
            &format!(
                r#"{{"ops":[{{"duration":"{persistent}","key":"{key}","value":"{value}","expected":"zz"}}]}}"#
            ),
            None,
        );

        assert_batch(
            &format!(
                r#"{{"ops":[{{"duration":"{persistent}","key":"{key}","expected":"{hash}"}}]}}"#
            ),
            Some((
                StoredValueOp::Check,
                Precondition::Read(ReadExpect::Hash(ciphertext_hash)),
            )),
        );

        let encoded_value = STANDARD.encode(vec![0u8; MAX_VALUE_LEN + 1]);
        assert_batch(
            &format!(
                r#"{{"ops":[{{"duration":"{persistent}","key":"{key}","value":"{encoded_value}"}}]}}"#
            ),
            None,
        );
    }
}
