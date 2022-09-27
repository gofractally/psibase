use crate::{psibase, Fracpack};
use custom_error::custom_error;
use psibase_names::{account_number_from_str, account_number_to_string};
use serde::{Deserialize, Serialize};
use std::{num::ParseIntError, str::FromStr};

custom_error! { pub AccountNumberError
    Invalid{s:String} = "Invalid AccountNumber {s}",
}

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
/// use psibase::AccountNumber;
/// let hello = AccountNumber::from("hello");
/// ```
#[derive(Debug, Default, PartialEq, Eq, Copy, Clone, Fracpack, Serialize, Deserialize)]
#[fracpack(definition_will_not_change)]
pub struct AccountNumber {
    pub value: u64,
}

impl AccountNumber {
    pub const fn new(value: u64) -> Self {
        AccountNumber { value }
    }

    pub fn from_exact(s: &str) -> Result<Self, AccountNumberError> {
        let result: Self = s.into();
        if result.to_string() != s {
            return Err(AccountNumberError::Invalid { s: s.into() });
        }
        Ok(result)
    }
}

impl From<u64> for AccountNumber {
    fn from(n: u64) -> Self {
        AccountNumber { value: n }
    }
}

impl From<ExactAccountNumber> for AccountNumber {
    fn from(n: ExactAccountNumber) -> Self {
        AccountNumber { value: n.value }
    }
}

impl FromStr for AccountNumber {
    type Err = ParseIntError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Ok(AccountNumber {
            value: account_number_from_str(s),
        })
    }
}

impl From<&str> for AccountNumber {
    fn from(s: &str) -> Self {
        AccountNumber::from_str(s).unwrap()
    }
}

impl std::fmt::Display for AccountNumber {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(account_number_to_string(self.value).as_str())
    }
}

/// Like AccountNumber, except FromStr requires exact round-trip conversion
#[derive(Debug, Default, PartialEq, Eq, Copy, Clone, Fracpack, Serialize, Deserialize)]
#[fracpack(definition_will_not_change)]
pub struct ExactAccountNumber {
    pub value: u64,
}

impl ExactAccountNumber {
    pub fn new(value: u64) -> Self {
        ExactAccountNumber { value }
    }
}

impl From<u64> for ExactAccountNumber {
    fn from(n: u64) -> Self {
        ExactAccountNumber { value: n }
    }
}

impl From<AccountNumber> for ExactAccountNumber {
    fn from(n: AccountNumber) -> Self {
        ExactAccountNumber { value: n.value }
    }
}

impl FromStr for ExactAccountNumber {
    type Err = AccountNumberError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Ok(ExactAccountNumber {
            value: AccountNumber::from_exact(s)?.value,
        })
    }
}

impl std::fmt::Display for ExactAccountNumber {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(account_number_to_string(self.value).as_str())
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
