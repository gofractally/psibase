use crate::{serialize_as_str, Pack, ToKey, ToSchema, Unpack};
use custom_error::custom_error;
use psibase_names::{account_number_from_str, account_number_to_string};
pub use psibase_names::{MAX_ACCOUNT_NAME_LENGTH, MIN_ACCOUNT_NAME_LENGTH};
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
#[derive(Debug, Default, PartialEq, Eq, Copy, Clone, Hash, Pack, Unpack, ToKey, ToSchema)]
#[fracpack(
    definition_will_not_change,
    fracpack_mod = "fracpack",
    custom = "AccountNumber"
)]
#[to_key(psibase_mod = "crate")]
pub struct AccountNumber {
    pub value: u64,
}

serialize_as_str!(AccountNumber, "account number");

pub struct Subaccount(u8);

impl AccountNumber {
    pub const MIN: Self = AccountNumber { value: 0 };
    pub const MAX: Self = AccountNumber { value: u64::MAX };

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

    pub fn with_subaccount(&self, sub: Subaccount) -> AccountNumber {
        AccountNumber::new(self.base().value + sub.0 as u64)
    }

    pub fn subaccount(&self) -> Subaccount {
        Subaccount((self.value & 0xff) as u8)
    }

    pub fn is_subaccount(&self) -> bool {
        self.subaccount().0 != 0
    }

    pub fn base(&self) -> AccountNumber {
        AccountNumber::new(self.value & !0xff)
    }

    pub fn split(&self) -> (AccountNumber, Subaccount) {
        (self.base(), self.subaccount())
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

/// Like AccountNumber, except FromStr and deserializing JSON require exact round-trip conversion
#[derive(Debug, Default, PartialEq, Eq, Copy, Clone, Pack, Unpack, ToKey)]
#[fracpack(
    definition_will_not_change,
    fracpack_mod = "fracpack",
    custom = "AccountNumber"
)]
#[to_key(psibase_mod = "crate")]
pub struct ExactAccountNumber {
    pub value: u64,
}

serialize_as_str!(ExactAccountNumber, "account number");

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
            AccountNumber::new(331048532879956736)
        );
        assert_eq!(
            AccountNumber::from_str("b").unwrap(),
            AccountNumber::new(364153386167952384)
        );
        assert_eq!(
            AccountNumber::from_str("c").unwrap(),
            AccountNumber::new(397258239455948032)
        );
        assert_eq!(
            AccountNumber::from_str("abc123").unwrap(),
            AccountNumber::new(342084831226198272)
        );
        assert_eq!(
            AccountNumber::from_str("spiderman").unwrap(),
            AccountNumber::new(950660654012764416)
        );
        assert_eq!(
            AccountNumber::from_str("brucewayne").unwrap(),
            AccountNumber::new(389958816282596608)
        );
        assert_eq!(
            AccountNumber::from_str("a+0").unwrap(),
            AccountNumber::new(331048532879956736)
        );
        assert_eq!(
            AccountNumber::from_str("a+42").unwrap(),
            AccountNumber::new(331048532879956736 + 42)
        );
        assert_eq!(
            AccountNumber::from_str("a+9").unwrap(),
            AccountNumber::new(331048532879956736 + 9)
        );
        assert_eq!(
            AccountNumber::from_str("a+90").unwrap(),
            AccountNumber::new(331048532879956736 + 90)
        );
        assert_eq!(
            AccountNumber::from_str("spiderman+255").unwrap(),
            AccountNumber::new(950660654012764416 + 255)
        );
    }

    #[test]
    fn name_number_value_to_string_is_converted_successfully() {
        let name = AccountNumber::from_str("a").unwrap();
        assert_eq!(name.value, 331048532879956736);
        assert_eq!(name.to_string(), "a");

        let name = AccountNumber::from_str("b").unwrap();
        assert_eq!(name.to_string(), "b");
        let name = AccountNumber::from(364153386167952384);
        assert_eq!(name.to_string(), "b");

        let name = AccountNumber::from_str("c").unwrap();
        assert_eq!(name.to_string(), "c");
        let name = AccountNumber::from(397258239455948032);
        assert_eq!(name.to_string(), "c");

        let name = AccountNumber::from_str("abc123").unwrap();
        assert_eq!(name.to_string(), "abc123");
        let name = AccountNumber::from(342084831226198272);
        assert_eq!(name.to_string(), "abc123");

        let name = AccountNumber::from_str("spiderman").unwrap();
        assert_eq!(name.to_string(), "spiderman");
        let name = AccountNumber::from(950660654012764416);
        assert_eq!(name.to_string(), "spiderman");

        let name = AccountNumber::from(0);
        assert_eq!(name.to_string(), "");

        let name = AccountNumber::from(331048532879956736 + 42);
        assert_eq!(name.to_string(), "a+42");

        let name = AccountNumber::from(331048532879956736 + 9);
        assert_eq!(name.to_string(), "a+9");
        let name = AccountNumber::from(331048532879956736 + 90);
        assert_eq!(name.to_string(), "a+90");
        let name = AccountNumber::from(950660654012764416 + 255);
        assert_eq!(name.to_string(), "spiderman+255");
    }
}
