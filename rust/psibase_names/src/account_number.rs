use crate::account_to_number_converter::AccountToNumberConverter;
use crate::constants::*;
use crate::number_to_string_converter::NumberToStringConverter;

fn account_number_has_valid_format(s: &str) -> bool {
    let mut chars = s.bytes();

    if chars.len() == 0 {
        return true;
    }

    let first_char = chars.next().unwrap();
    if first_char <= b'9' {
        return false;
    }

    let mut char_ascii = first_char as usize;
    loop {
        if CHAR_TO_SYMBOL[char_ascii] == 0 {
            return false;
        }

        if let Some(next_char) = chars.next() {
            char_ascii = next_char as usize;
        } else {
            break;
        }
    }

    true
}

/// Convert an account number from string to `u64`.
///
/// Psibase account numbers are 64-bit values which are compressed
/// from strings (names). Names may be 0 to 18 characters long and
/// contain the characters `a-z`, `0-9`, and `-` (hyphen).
/// Non-empty names must begin with a letter.
///
/// There are some names which meet the above rules, but fail to
/// compress down to 64 bits. These names are invalid. Likewise,
/// there are some 64-bit integers which aren't the compressed
/// form of valid names; these are also invalid.
///
/// This function does minimal checking; if `s` isn't valid, then
/// [`account_number_to_string`] will return a string which doesn't
/// match `s`. Many, but not all, invalid names produce value `0`.
///
/// The empty name `""` is value 0.
pub fn account_number_from_str(s: &str) -> u64 {
    if s.is_empty() || s.len() > 18 || !account_number_has_valid_format(s) {
        0
    } else {
        AccountToNumberConverter::convert(s)
    }
}

/// Convert `u64` account number to string.
///
/// This doesn't do any checking; if `value` isn't valid, then
/// this will return a string which doesn't round-trip back to
/// `value`.
pub fn account_number_to_string(value: u64) -> String {
    if value == 0 {
        "".into() // TODO: review impl empty string
    } else {
        NumberToStringConverter::convert(value, &MODEL_CF, &SYMBOL_TO_CHAR)
    }
}
