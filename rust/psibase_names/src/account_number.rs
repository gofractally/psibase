use crate::name_encoder::NameEncoder;

const ACCOUNT_ENCODER: NameEncoder<10> = NameEncoder::new(36);

const CHARS: &'static str = "-0123456789abcdefghijklmnopqrstuvwxyz";

const SUBACCOUNT_SEPARATOR: &'static str = "+";

fn char_index(ch: u8) -> u64 {
    let ch = ch as char;
    let offset_from = |base: char| ch as u64 - base as u64;
    if ch == '-' {
        0
    } else if ch >= '0' && ch <= '9' {
        offset_from('0') + 1
    } else if ch >= 'a' && ch <= 'z' {
        offset_from('a') + 11
    } else if ch >= 'A' && ch <= 'Z' {
        offset_from('A') as u64 + 11
    } else {
        u64::MAX
    }
}

pub const MIN_ACCOUNT_NAME_LENGTH: u8 = 1;
pub const MAX_ACCOUNT_NAME_LENGTH: u8 = 10;

fn account_number_has_valid_format(s: &str) -> bool {
    if s.starts_with('-') || s.ends_with('-') || s.contains("--") {
        return false;
    }

    s.bytes().all(|ch| char_index(ch) != u64::MAX)
}

/// Convert an account number from string to `u64`.
///
/// Psibase account numbers are 64-bit values which are compressed
/// from strings (names). Names may be 0 to 10 characters long and
/// contain the characters `a-z`, `0-9`, and `-` (hyphen). Names
/// must not start or end with '-' or contain two consecutive '-'s
///
/// The empty name `""` is value 0.
pub fn account_number_from_str(s: &str) -> u64 {
    if let Some((base, sub)) = s.split_once(SUBACCOUNT_SEPARATOR) {
        return account_number_from_str(base) + (sub.parse::<u8>().unwrap() as u64);
    }
    if s.is_empty()
        || s.len() > MAX_ACCOUNT_NAME_LENGTH as usize
        || !account_number_has_valid_format(s)
    {
        0
    } else {
        ACCOUNT_ENCODER.encode(s.bytes().map(|b| char_index(b)), 0) << 8
    }
}

/// Convert `u64` account number to string.
///
/// This doesn't do any checking; if `value` isn't valid, then
/// this will return a string which doesn't round-trip back to
/// `value`.
pub fn account_number_to_string(value: u64) -> String {
    if (value & 0xff) != 0 {
        return account_number_to_string(value & !0xff)
            + SUBACCOUNT_SEPARATOR
            + &(value & 0xff).to_string();
    }
    ACCOUNT_ENCODER
        .decode(value >> 8, 0)
        .map(|idx| CHARS.as_bytes()[idx as usize] as char)
        .collect()
}
