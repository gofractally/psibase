//! Frozen integer-only action/event/reflected-name codec. Regenerate the model
//! with `tools/action_names.py`; consumer code never needs retraining edits.
use sha2::{Digest, Sha256};
use std::{fmt, sync::OnceLock};

mod model {
    include!("action_name_model.generated.rs");
}
pub const ACTION_NAME_MODEL_SHA256: &str = model::MODEL_SHA256;
pub const ACTION_NAME_FORMAT_VERSION: &str = model::FORMAT_VERSION;
const ALPHABET: &[u8; 37] = b"abcdefghijklmnopqrstuvwxyz0123456789_";
const MAX_LENGTH: usize = 256;
const PAYLOAD_MASK: u64 = (1u64 << 62) - 1;
const TOTAL: u64 = 32768;
const MAX: u64 = (1u64 << 32) - 1;
const HALF: u64 = 1u64 << 31;
const QUARTER: u64 = 1u64 << 30;
const THREE_QUARTERS: u64 = 3u64 << 30;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ActionNameError {
    InvalidName,
    InvalidHashLiteral,
    InvalidId,
}
impl fmt::Display for ActionNameError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::InvalidName => "action name must be an ASCII identifier of 1..256 characters",
            Self::InvalidHashLiteral => {
                "action hash literal must be # plus 16 lowercase hex digits with tag 3"
            }
            Self::InvalidId => "noncanonical or invalid action name ID",
        })
    }
}
impl std::error::Error for ActionNameError {}

fn symbol(byte: u8) -> usize {
    match byte {
        b'a'..=b'z' => (byte - b'a') as usize,
        b'0'..=b'9' => (byte - b'0') as usize + 26,
        b'_' => 36,
        _ => unreachable!("canonical action-name alphabet"),
    }
}
fn canonical_name(name: &str) -> Result<Vec<u8>, ActionNameError> {
    let bytes = name.as_bytes();
    if bytes.is_empty()
        || bytes.len() > MAX_LENGTH
        || !(bytes[0].is_ascii_alphabetic() || bytes[0] == b'_')
        || bytes
            .iter()
            .any(|c| !(c.is_ascii_alphanumeric() || *c == b'_'))
    {
        return Err(ActionNameError::InvalidName);
    }
    Ok(bytes.iter().map(u8::to_ascii_lowercase).collect())
}
fn char_cdf(previous: &[usize]) -> &[u16] {
    let row = match previous {
        [] => 0,
        [a] => 1 + a,
        [a, b] => 38 + 37 * a + b,
        _ => unreachable!(),
    };
    &model::CHAR_CDF[row]
}

#[derive(Clone, Copy)]
struct Path {
    valid: bool,
    cost: u64,
    count: usize,
    previous: usize,
    token: usize,
}
const NO_PATH: Path = Path {
    valid: false,
    cost: 0,
    count: 0,
    previous: 0,
    token: 0,
};
fn path_tokens(paths: &[Path], mut end: usize) -> Vec<usize> {
    let mut result = Vec::with_capacity(paths[end].count);
    while end != 0 {
        result.push(paths[end].token);
        end = paths[end].previous;
    }
    result.reverse();
    result
}
fn word_buckets() -> &'static [Vec<usize>; 37] {
    static BUCKETS: OnceLock<[Vec<usize>; 37]> = OnceLock::new();
    BUCKETS.get_or_init(|| {
        let mut buckets: [Vec<usize>; 37] = std::array::from_fn(|_| Vec::new());
        for (index, word) in model::WORDS.iter().enumerate().skip(1) {
            buckets[symbol(word.as_bytes()[0])].push(index);
        }
        buckets
    })
}
fn word_tokens(name: &[u8]) -> Vec<usize> {
    let mut paths = [NO_PATH; MAX_LENGTH + 1];
    paths[0].valid = true;
    for begin in 0..name.len() {
        if !paths[begin].valid {
            continue;
        }
        for &token in &word_buckets()[symbol(name[begin])] {
            let word = model::WORDS[token].as_bytes();
            if !name[begin..].starts_with(word) {
                continue;
            }
            let end = begin + word.len();
            let proposal = Path {
                valid: true,
                cost: paths[begin].cost + model::WORD_COSTS[token] as u64,
                count: paths[begin].count + 1,
                previous: begin,
                token,
            };
            let previous = paths[end];
            let basic = (proposal.cost, proposal.count);
            let old = (previous.cost, previous.count);
            let better = !previous.valid
                || basic < old
                || (basic == old && {
                    let mut candidate = path_tokens(&paths, begin);
                    candidate.push(token);
                    candidate < path_tokens(&paths, end)
                });
            if better {
                paths[end] = proposal;
            }
        }
    }
    debug_assert!(paths[name.len()].valid); // Single-character tokens cover every name.
    path_tokens(&paths, name.len())
}

struct Bits {
    value: u64,
    count: u32,
    pending: u32,
}
impl Bits {
    fn emit(&mut self, bit: u64) -> Option<()> {
        if self.count + 1 + self.pending > 62 {
            return None;
        }
        self.value = (self.value << 1) | bit;
        self.count += 1;
        while self.pending != 0 {
            self.value = (self.value << 1) | (1 - bit);
            self.count += 1;
            self.pending -= 1;
        }
        Some(())
    }
}
fn arithmetic_encode(name: &[u8], word: bool) -> Option<(u32, u64)> {
    let tokens: Vec<usize> = if word {
        word_tokens(name)
    } else {
        name.iter().map(|c| symbol(*c) + 1).collect()
    };
    let (mut low, mut high) = (0, MAX);
    let mut bits = Bits {
        value: 0,
        count: 0,
        pending: 0,
    };
    let mut previous = Vec::with_capacity(2);
    for index in tokens.into_iter().chain(std::iter::once(0)) {
        let cdf: &[u16] = if word {
            &model::WORD_CDF
        } else {
            char_cdf(&previous)
        };
        let width = high - low + 1;
        high = low + width * cdf[index + 1] as u64 / TOTAL - 1;
        low += width * cdf[index] as u64 / TOTAL;
        loop {
            if high < HALF {
                bits.emit(0)?;
            } else if low >= HALF {
                bits.emit(1)?;
                low -= HALF;
                high -= HALF;
            } else if low >= QUARTER && high < THREE_QUARTERS {
                bits.pending += 1;
                if bits.count + bits.pending > 62 {
                    return None;
                }
                low -= QUARTER;
                high -= QUARTER;
            } else {
                break;
            }
            low <<= 1;
            high = (high << 1) | 1;
        }
        if !word && index != 0 {
            if previous.len() == 2 {
                previous.remove(0);
            }
            previous.push(index - 1);
        }
    }
    bits.pending += 1;
    bits.emit(if low < QUARTER { 0 } else { 1 })?;
    if bits.value == 0 {
        None
    } else {
        Some((bits.count, bits.value << (62 - bits.count)))
    }
}
fn literal(name: &[u8]) -> Option<(u32, u64)> {
    let mut value = 0u64;
    for c in name {
        value = value.checked_mul(37)?.checked_add(symbol(*c) as u64 + 1)?;
        if value > PAYLOAD_MASK {
            return None;
        }
    }
    Some((64 - value.leading_zeros(), value))
}
fn encode_canonical(name: &[u8]) -> u64 {
    let mut best: Option<(u32, u64, u64)> = None;
    for (mode, candidate) in [
        (0, arithmetic_encode(name, false)),
        (1, arithmetic_encode(name, true)),
        (2, literal(name)),
    ] {
        if let Some((bits, value)) = candidate {
            let option = (bits, mode, value);
            if best.map_or(true, |old| option < old) {
                best = Some(option);
            }
        }
    }
    if let Some((_, mode, value)) = best {
        (mode << 62) | value
    } else {
        hash_name_bytes(name)
    }
}

fn hash_name_bytes(name: &[u8]) -> u64 {
    let digest = Sha256::new()
        .chain_update(b"psibase.action_name.v1\0")
        .chain_update(name)
        .finalize();
    (3 << 62) | (u64::from_le_bytes(digest[..8].try_into().unwrap()) & PAYLOAD_MASK)
}

/// Strictly encode an ASCII identifier or canonical hash literal into a u64.
pub fn action_name_from_str(name: &str) -> Result<u64, ActionNameError> {
    if name.starts_with('#') {
        let hex = &name.as_bytes()[1..];
        if hex.len() != 16
            || hex
                .iter()
                .any(|c| !(c.is_ascii_digit() || (b'a'..=b'f').contains(c)))
        {
            return Err(ActionNameError::InvalidHashLiteral);
        }
        let value =
            u64::from_str_radix(&name[1..], 16).map_err(|_| ActionNameError::InvalidHashLiteral)?;
        if value >> 62 != 3 {
            return Err(ActionNameError::InvalidHashLiteral);
        }
        Ok(value)
    } else {
        Ok(encode_canonical(&canonical_name(name)?))
    }
}
fn arithmetic_decode(payload: u64, word: bool) -> Result<Vec<u8>, ActionNameError> {
    let value = payload << 1;
    let mut position = 0;
    let mut take = || {
        let bit = if position < 63 {
            (value >> (62 - position)) & 1
        } else {
            0
        };
        position += 1;
        bit
    };
    let (mut low, mut high, mut code) = (0, MAX, 0);
    for _ in 0..32 {
        code = (code << 1) | take();
    }
    let mut previous = Vec::with_capacity(2);
    let mut result = Vec::new();
    for _ in 0..=MAX_LENGTH {
        if code < low || code > high {
            return Err(ActionNameError::InvalidId);
        }
        let cdf: &[u16] = if word {
            &model::WORD_CDF
        } else {
            char_cdf(&previous)
        };
        let width = high - low + 1;
        let scaled = ((code - low + 1) * TOTAL - 1) / width;
        let end = cdf.partition_point(|&boundary| boundary as u64 <= scaled);
        if end == 0 || end >= cdf.len() {
            return Err(ActionNameError::InvalidId);
        }
        let index = end - 1;
        if index == 0 {
            return Ok(result);
        }
        if word {
            result.extend_from_slice(model::WORDS[index].as_bytes());
        } else {
            result.push(ALPHABET[index - 1]);
        }
        if result.len() > MAX_LENGTH {
            return Err(ActionNameError::InvalidId);
        }
        high = low + width * cdf[index + 1] as u64 / TOTAL - 1;
        low += width * cdf[index] as u64 / TOTAL;
        loop {
            if high < HALF {
            } else if low >= HALF {
                code -= HALF;
                low -= HALF;
                high -= HALF;
            } else if low >= QUARTER && high < THREE_QUARTERS {
                code -= QUARTER;
                low -= QUARTER;
                high -= QUARTER;
            } else {
                break;
            }
            low <<= 1;
            high = (high << 1) | 1;
            code = (code << 1) | take();
        }
        if !word {
            if previous.len() == 2 {
                previous.remove(0);
            }
            previous.push(index - 1);
        }
    }
    Err(ActionNameError::InvalidId)
}

/// Decode a canonical readable ID or its exact `#` hash literal. Noncanonical
/// arithmetic padding, malformed identifiers and unbounded streams are errors.
pub fn action_name_to_string(value: u64) -> Result<String, ActionNameError> {
    let mode = value >> 62;
    if mode == 3 {
        return Ok(format!("#{value:016x}"));
    }
    let mut payload = value & PAYLOAD_MASK;
    let bytes = match mode {
        0 | 1 => arithmetic_decode(payload, mode == 1)?,
        2 => {
            let mut bytes = Vec::new();
            while payload != 0 {
                let quotient = (payload - 1) / 37;
                let remainder = (payload - 1) % 37;
                bytes.push(ALPHABET[remainder as usize]);
                payload = quotient;
            }
            bytes.reverse();
            bytes
        }
        _ => unreachable!(),
    };
    let name = String::from_utf8(bytes).map_err(|_| ActionNameError::InvalidId)?;
    let canonical = canonical_name(&name).map_err(|_| ActionNameError::InvalidId)?;
    if canonical.as_slice() != name.as_bytes() || encode_canonical(&canonical) != value {
        return Err(ActionNameError::InvalidId);
    }
    Ok(name)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn strict_names_and_literals() {
        for name in [
            "",
            "1get",
            "get-data",
            "two words",
            "é",
            "#short",
            "#0000000000000000",
            "#C000000000000000",
        ] {
            assert!(action_name_from_str(name).is_err(), "{name}");
        }
        assert!(action_name_from_str(&"a".repeat(257)).is_err());
        assert!(action_name_from_str(&"a".repeat(256)).is_ok());
        assert!(action_name_to_string(0).is_err());
        assert_eq!(action_name_from_str("#ffffffffffffffff").unwrap(), u64::MAX);
    }
    #[test]
    fn identifiers_round_trip_and_normalize_only_case() {
        for name in [
            "hello",
            "getUint32",
            "getInt32",
            "foo_bar",
            "fooqbar",
            "sx",
            "szziat",
            "requestRecovery",
            "set_guild_weight_curve",
            "cpu_blocks_avg",
        ] {
            let number = action_name_from_str(name).unwrap();
            let decoded = action_name_to_string(number).unwrap();
            assert_eq!(action_name_from_str(&decoded).unwrap(), number);
            if number >> 62 != 3 {
                assert_eq!(decoded, name.to_ascii_lowercase());
            }
        }
        assert_eq!(
            action_name_from_str("GetData"),
            action_name_from_str("getdata")
        );
        assert_ne!(
            action_name_from_str("foo_bar"),
            action_name_from_str("fooqbar")
        );
        assert_ne!(action_name_from_str("load0"), action_name_from_str("loado"));
        assert_ne!(action_name_from_str("sx"), action_name_from_str("szziat"));
    }
    #[test]
    fn hash_domain_and_byte_order() {
        // Test the fixed hash contract independently of which names a future
        // trained model happens to represent readably.
        let name = "hashContractExample";
        let value = hash_name_bytes(name.as_bytes());
        assert_eq!(value >> 62, 3);
        let hash = Sha256::new()
            .chain_update(b"psibase.action_name.v1\0")
            .chain_update(name.as_bytes())
            .finalize();
        assert_eq!(
            value,
            (3 << 62) | (u64::from_le_bytes(hash[..8].try_into().unwrap()) & PAYLOAD_MASK)
        );
        assert_eq!(
            action_name_from_str(&action_name_to_string(value).unwrap()).unwrap(),
            value
        );
    }

    #[test]
    fn arbitrary_raw_ids_are_bounded_and_canonical_when_accepted() {
        let mut value = 0x71a3_65db_e98f_240cu64;
        for _ in 0..1000 {
            value = value
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            if let Ok(name) = action_name_to_string(value) {
                assert_eq!(action_name_from_str(&name).unwrap(), value);
            }
        }
    }
}
