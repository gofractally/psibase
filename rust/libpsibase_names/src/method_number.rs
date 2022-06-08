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

pub fn method_number_to_string(value: u64) -> String {
    if value == 0 {
        "".into() // TODO: review impl empty string
    } else if method_number_is_hash(value) {
        method_number_to_hash(value)
    } else {
        NumberToStringConverter::convert(value, &MODEL_CF_METHOD, &SYMBOL_TO_CHAR_METHOD)
    }
}
