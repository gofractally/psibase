use crate::constants::*;
use crate::method_to_number_converter::MethodToNumberConverter;
use crate::number_to_string_converter::NumberToStringConverter;

fn method_number_has_valid_chars(s: &str) -> bool {
    for c in s.bytes() {
        if CHAR_TO_SYMBOL_METHOD[c as usize] == 0 {
            return false;
        }
    }
    true
}

fn method_number_is_hash(value: u64) -> bool {
    value & (0x01_u64 << (64 - 8)) > 0
}

fn method_number_to_hash(value: u64) -> String {
    let mut out = String::from("#");

    let mut r = value;
    for _ in 0..16 {
        let symbol = (r & 0x0f) as usize + 1;
        out.push(SYMBOL_TO_CHAR_METHOD[symbol] as char);
        r >>= 4;
    }

    out
}

fn method_number_parse_hash(s: &str) -> Option<u64> {
    let mut chars = s.bytes();

    let first_char = chars.next().unwrap();
    if first_char != b'#' || s.len() != 17 {
        return None;
    }

    let mut output: u64 = 0;

    let mut i = 1;

    for c in chars {
        let mut sym = (CHAR_TO_SYMBOL_METHOD[c as usize] - 1) as u64;
        sym <<= 4 * (i - 1);
        output |= sym;
        i += 1;
    }

    Some(output)
}

/// Convert a method number from string to `u64`.
///
/// Psibase method numbers are 64-bit values which are compressed
/// from strings (names). They contain the characters `a-z`, and
/// `0-9`. Non-empty names must begin with a letter. `A-Z`
/// round-trips as `a-z`. `_` (underscore) is dropped.
///
/// There are some names which meet the above rules, but fail to
/// compress down to 64 bits. These names are invalid. Likewise,
/// there are some 64-bit integers which aren't the compressed
/// form of valid names; these are also invalid. Some invalid
/// names fall back to a hash (below).
///
/// There is a special case when bit 48 is set. `str()` returns
/// a string which begins with `#` followed by 16 letters. This
/// is an alternative hex representation which represents the
/// hash of a name which failed to compress. Once a name is in
/// this form, it will round trip with no further changes.
///
/// This function does minimal checking; if `s` isn't valid, then
/// [method_number_to_string] will return a string which doesn't
/// match `s`. Many, but not all, invalid names produce a hashed
/// value. Some produce 0.
///
/// The empty name `""` is value 0.
pub fn method_number_from_str(s: &str) -> u64 {
    if s.is_empty() {
        return 0;
    }

    method_number_parse_hash(s).unwrap_or_else(|| {
        if method_number_has_valid_chars(s) {
            MethodToNumberConverter::convert(s)
        } else {
            0
        }
    })
}

/// Convert `u64` method number to string.
///
/// This doesn't do any checking; if `value` isn't valid, then
/// this will return a string which doesn't round-trip back to
/// `value`.
pub fn method_number_to_string(value: u64) -> String {
    if value == 0 {
        "".into() // TODO: review impl empty string
    } else if method_number_is_hash(value) {
        method_number_to_hash(value)
    } else {
        NumberToStringConverter::convert(value, &MODEL_CF_METHOD, &SYMBOL_TO_CHAR_METHOD)
    }
}
