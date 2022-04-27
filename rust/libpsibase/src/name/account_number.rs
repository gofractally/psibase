use super::constants::*;
use super::{
    account_to_number_converter::AccountToNumberConverter,
    number_to_string_converter::NumberToStringConverter,
};
use std::{num::ParseIntError, str::FromStr};

/// An account number.
///
/// The `AccountNumber` is used to reference accounts in psibase. This type
/// is a convenient handler to allow consumers to parse and convert their readable
/// names.
///
/// # Examples
///
/// You can create an `AccountNumber` from [a literal string][`&str`] with [`AccountNumber::from`]:
///
/// ```
/// use libpsibase::AccountNumber;
/// let hello = AccountNumber::from("hello");
/// ```
#[derive(Debug, Default, PartialEq)]
pub struct AccountNumber {
    pub value: u64,
}

impl AccountNumber {
    pub fn new(value: u64) -> Self {
        AccountNumber { value }
    }

    pub fn has_valid_format(s: &str) -> bool {
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
}

impl From<u64> for AccountNumber {
    fn from(n: u64) -> Self {
        AccountNumber { value: n }
    }
}

impl FromStr for AccountNumber {
    type Err = ParseIntError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        if s.is_empty() || s.len() > 18 || !AccountNumber::has_valid_format(s) {
            return Ok(AccountNumber::default());
        }

        let value = AccountToNumberConverter::convert(s);
        Ok(AccountNumber { value })
    }
}

impl From<&str> for AccountNumber {
    fn from(s: &str) -> Self {
        AccountNumber::from_str(s).unwrap()
    }
}

impl std::fmt::Display for AccountNumber {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        if self.value == 0 {
            return f.write_str(""); // TODO: review impl empty string
        }

        f.write_str(
            NumberToStringConverter::convert(self.value, &MODEL_CF, &SYMBOL_TO_CHAR).as_str(),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_name_is_zero() {
        assert_eq!(AccountNumber::from_str("").unwrap(), AccountNumber::new(0));
    }

    #[test]
    fn name_longer_than_limit_of_18_is_zero() {
        assert_eq!(
            AccountNumber::from_str("abcdefghijklmnopqrstuvwxyz").unwrap(),
            AccountNumber::new(0)
        );
    }

    #[test]
    fn name_starting_with_a_char_less_than_9_returns_zero() {
        assert_eq!(AccountNumber::from_str("9").unwrap(), AccountNumber::new(0));
        assert_eq!(AccountNumber::from_str("3").unwrap(), AccountNumber::new(0));
        assert_eq!(
            AccountNumber::from_str("1abc").unwrap(),
            AccountNumber::new(0)
        );
        assert_eq!(
            AccountNumber::from_str("1234").unwrap(),
            AccountNumber::new(0)
        );
        assert_eq!(
            AccountNumber::from_str("9asdf").unwrap(),
            AccountNumber::new(0)
        );
        assert_ne!(
            AccountNumber::from_str("abcd").unwrap(),
            AccountNumber::new(0)
        );
        assert_ne!(
            AccountNumber::from_str("asdf9").unwrap(),
            AccountNumber::new(0)
        );
        assert_ne!(
            AccountNumber::from_str("abc1").unwrap(),
            AccountNumber::new(0)
        );
    }

    #[test]
    fn any_unknown_char_returns_zero() {
        assert_eq!(AccountNumber::from_str("?").unwrap(), AccountNumber::new(0));
        assert_eq!(
            AccountNumber::from_str("what?").unwrap(),
            AccountNumber::new(0)
        );
        assert_eq!(
            AccountNumber::from_str("?what").unwrap(),
            AccountNumber::new(0)
        );
        assert_eq!(
            AccountNumber::from_str("eaorintsl?").unwrap(),
            AccountNumber::new(0)
        );
        assert_eq!(
            AccountNumber::from_str("????").unwrap(),
            AccountNumber::new(0)
        );
    }

    #[test]
    fn returns_proper_numbers_from_str() {
        assert_eq!(
            AccountNumber::from_str("a").unwrap(),
            AccountNumber::new(49158)
        );
        assert_eq!(
            AccountNumber::from_str("b").unwrap(),
            AccountNumber::new(184)
        );
        assert_eq!(
            AccountNumber::from_str("c").unwrap(),
            AccountNumber::new(16538)
        );
        assert_eq!(
            AccountNumber::from_str("abc123").unwrap(),
            AccountNumber::new(1754468116)
        );
        assert_eq!(
            AccountNumber::from_str("spiderman").unwrap(),
            AccountNumber::new(483466201442)
        );
        assert_eq!(
            AccountNumber::from_str("brucewayne").unwrap(),
            AccountNumber::new(132946582102463)
        );
        assert_eq!(
            AccountNumber::from_str("anthonystark").unwrap(),
            AccountNumber::new(183678712946955)
        );
        assert_eq!(
            AccountNumber::from_str("natasharomanoff").unwrap(),
            AccountNumber::new(5818245174062392369)
        );
    }

    #[test]
    fn name_number_value_to_string_is_converted_successfully() {
        let name = AccountNumber::from_str("a").unwrap();
        assert_eq!(name.value, 49158);
        assert_eq!(name.to_string(), "a");

        let name = AccountNumber::from_str("b").unwrap();
        assert_eq!(name.to_string(), "b");
        let name = AccountNumber::from(184);
        assert_eq!(name.to_string(), "b");

        let name = AccountNumber::from_str("c").unwrap();
        assert_eq!(name.to_string(), "c");
        let name = AccountNumber::from(16538);
        assert_eq!(name.to_string(), "c");

        let name = AccountNumber::from_str("abc123").unwrap();
        assert_eq!(name.to_string(), "abc123");
        let name = AccountNumber::from(1754468116);
        assert_eq!(name.to_string(), "abc123");

        let name = AccountNumber::from_str("spiderman").unwrap();
        assert_eq!(name.to_string(), "spiderman");
        let name = AccountNumber::from(483466201442);
        assert_eq!(name.to_string(), "spiderman");

        let name = AccountNumber::from(0);
        assert_eq!(name.to_string(), "");
    }
}
