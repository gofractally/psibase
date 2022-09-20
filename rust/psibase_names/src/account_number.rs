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

pub fn account_number_from_str(s: &str) -> u64 {
    if s.is_empty() || s.len() > 18 || !account_number_has_valid_format(s) {
        0
    } else {
        AccountToNumberConverter::convert(s)
    }
}

pub fn account_number_to_string(value: u64) -> String {
    if value == 0 {
        "".into() // TODO: review impl empty string
    } else {
        NumberToStringConverter::convert(value, &MODEL_CF, &SYMBOL_TO_CHAR)
    }
}
