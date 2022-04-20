mod constants;
mod frequency;
mod number_to_string;
mod string_to_number;

use self::constants::*;
use self::number_to_string::NumberToStringConverter;
use self::string_to_number::StringToNumberConverter;
use std::{num::ParseIntError, str::FromStr};

#[derive(Debug, Default, PartialEq)]
pub struct Name {
    value: u64,
}

impl Name {
    pub fn new(value: u64) -> Self {
        Name { value }
    }

    pub fn has_valid_format(s: &str) -> bool {
        let mut chars = s.bytes();

        let first_char = chars.next().unwrap();
        if first_char <= b'9' {
            return false;
        }

        let mut char_ascii = first_char as usize;
        loop {
            if char_ascii >= CHAR_TO_SYMBOL.len() || CHAR_TO_SYMBOL[char_ascii] == 0 {
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
}

impl From<u64> for Name {
    fn from(n: u64) -> Self {
        Name { value: n }
    }
}

impl FromStr for Name {
    type Err = ParseIntError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        if s.is_empty() || s.len() > 18 || !Name::has_valid_format(s) {
            return Ok(Name::default());
        }

        let value = StringToNumberConverter::convert(s);
        Ok(Name { value })
    }
}

impl std::fmt::Display for Name {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        if self.value == 0 {
            return f.write_str(""); // TODO: review impl empty string
        }

        f.write_str(NumberToStringConverter::convert(self.value).as_str())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn assert_parameters() {
        assert_eq!(CODE_VALUE_BITS, 17);
        assert_eq!(MAX_CODE, 131071);
        assert_eq!(ONE_FOURTH, 32768);
        assert_eq!(ONE_HALF, 65536);
        assert_eq!(THREE_FOURTHS, 98304);
    }

    #[test]
    fn empty_name_is_zero() {
        assert_eq!(Name::from_str("").unwrap(), Name::new(0));
    }

    #[test]
    fn name_longer_than_limit_of_18_is_zero() {
        assert_eq!(
            Name::from_str("abcdefghijklmnopqrstuvwxyz").unwrap(),
            Name::new(0)
        );
    }

    #[test]
    fn name_starting_with_a_char_less_than_9_returns_zero() {
        assert_eq!(Name::from_str("9").unwrap(), Name::new(0));
        assert_eq!(Name::from_str("3").unwrap(), Name::new(0));
        assert_eq!(Name::from_str("1abc").unwrap(), Name::new(0));
        assert_eq!(Name::from_str("1234").unwrap(), Name::new(0));
        assert_eq!(Name::from_str("9asdf").unwrap(), Name::new(0));
        assert_ne!(Name::from_str("abcd").unwrap(), Name::new(0));
        assert_ne!(Name::from_str("asdf9").unwrap(), Name::new(0));
        assert_ne!(Name::from_str("abc1").unwrap(), Name::new(0));
    }

    #[test]
    fn any_unknown_char_returns_zero() {
        assert_eq!(Name::from_str("?").unwrap(), Name::new(0));
        assert_eq!(Name::from_str("what?").unwrap(), Name::new(0));
        assert_eq!(Name::from_str("?what").unwrap(), Name::new(0));
        assert_eq!(Name::from_str("eaorintsl?").unwrap(), Name::new(0));
        assert_eq!(Name::from_str("????").unwrap(), Name::new(0));
    }

    #[test]
    fn returns_proper_numbers_from_str() {
        assert_eq!(Name::from_str("a").unwrap(), Name::new(49158));
        assert_eq!(Name::from_str("b").unwrap(), Name::new(184));
        assert_eq!(Name::from_str("c").unwrap(), Name::new(16538));
        assert_eq!(Name::from_str("abc123").unwrap(), Name::new(1754468116));
        assert_eq!(
            Name::from_str("spiderman").unwrap(),
            Name::new(483466201442)
        );
        assert_eq!(
            Name::from_str("brucewayne").unwrap(),
            Name::new(132946582102463)
        );
        assert_eq!(
            Name::from_str("anthonystark").unwrap(),
            Name::new(183678712946955)
        );
        assert_eq!(
            Name::from_str("natasharomanoff").unwrap(),
            Name::new(5818245174062392369)
        );
    }

    #[test]
    fn name_number_value_to_string_is_converted_successfully() {
        let name = Name::from_str("a").unwrap();
        assert_eq!(name.value, 49158);
        assert_eq!(name.to_string(), "a");

        let name = Name::from_str("b").unwrap();
        assert_eq!(name.to_string(), "b");
        let name = Name::from(184);
        assert_eq!(name.to_string(), "b");

        let name = Name::from_str("c").unwrap();
        assert_eq!(name.to_string(), "c");
        let name = Name::from(16538);
        assert_eq!(name.to_string(), "c");

        let name = Name::from_str("abc123").unwrap();
        assert_eq!(name.to_string(), "abc123");
        let name = Name::from(1754468116);
        assert_eq!(name.to_string(), "abc123");

        let name = Name::from_str("spiderman").unwrap();
        assert_eq!(name.to_string(), "spiderman");
        let name = Name::from(483466201442);
        assert_eq!(name.to_string(), "spiderman");
    }
}
