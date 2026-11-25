use custom_error::custom_error;
use psio::compress_name::{method_to_number, number_to_method};
use std::{num::ParseIntError, str::FromStr};

custom_error! { pub MethodNumberError
    Invalid{s:String} = "Invalid MethodNumber {s}",
}

/// A contract method number.
///
/// The `MethodNumber` is used to reference contract methods in psibase. This type
/// is a convenient handler to allow consumers to parse and convert their readable
/// names.
///
/// # Examples
///
/// You can create a `MethodNumber` from [a literal string][`&str`] with [`MethodNumber::from`]:
///
/// [`MethodNumber::from`]: From::from
///
/// ```
/// use psibase::MethodNumber;
/// let hello = MethodNumber::from("hello");
/// ```
#[derive(
    Debug,
    Default,
    PartialEq,
    Eq,
    Copy,
    Clone,
    Hash,
    psio::PsszPack,
    psio::PsszUnpack,
    psio::PsszView,
    psio::ToPsszSchema,
    psio::Key,
    psio::Serde,
)]
#[psio(definition_will_not_change, custom = "MethodNumber")]
pub struct MethodNumber {
    pub value: u64,
}

/// The text of a method is its name. Every spelling that names a method is
/// read: the one [`Display`](std::fmt::Display) writes, an identifier as
/// written in source (`setCode`), and the `#` form of a name that does not
/// compress. Text that names no method is not a value.
impl psio::json::TextForm for MethodNumber {
    fn to_text(&self, out: &mut String) {
        out.push_str(&number_to_method(self.value));
    }
    fn from_text(text: &str) -> Option<Self> {
        if text.is_empty() {
            return Some(MethodNumber { value: 0 });
        }
        let value = method_to_number(text);
        let names_a_method = if text.starts_with('#') {
            number_to_method(value) == text
        } else {
            value != 0
        };
        names_a_method.then_some(MethodNumber { value })
    }
}
psio::json_text_form!(MethodNumber);
psio::async_graphql_scalar!(MethodNumber, "MethodNumber");

impl MethodNumber {
    pub fn new(value: u64) -> Self {
        MethodNumber { value }
    }
}

impl From<u64> for MethodNumber {
    fn from(n: u64) -> Self {
        MethodNumber { value: n }
    }
}

impl FromStr for MethodNumber {
    type Err = ParseIntError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Ok(MethodNumber {
            value: method_to_number(s),
        })
    }
}

impl From<&str> for MethodNumber {
    fn from(s: &str) -> Self {
        MethodNumber::from_str(s).unwrap()
    }
}

impl std::fmt::Display for MethodNumber {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(number_to_method(self.value).as_str())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_name_is_zero() {
        assert_eq!(MethodNumber::from_str("").unwrap(), MethodNumber::new(0));
    }

    #[test]
    fn any_unknown_char_returns_zero() {
        assert_eq!(MethodNumber::from_str("?").unwrap(), MethodNumber::new(0));
        assert_eq!(
            MethodNumber::from_str("what?").unwrap(),
            MethodNumber::new(0)
        );
        assert_eq!(
            MethodNumber::from_str("?what").unwrap(),
            MethodNumber::new(0)
        );
        assert_eq!(
            MethodNumber::from_str("eaorintsl?").unwrap(),
            MethodNumber::new(0)
        );
        assert_eq!(
            MethodNumber::from_str("????").unwrap(),
            MethodNumber::new(0)
        );
    }

    #[test]
    fn parses_hash_successfully() {
        assert_eq!(
            MethodNumber::from_str("#hneunophpilcroch").unwrap(),
            MethodNumber::new(13346021867974402139)
        );

        assert_eq!(
            MethodNumber::from_str("#niiutpmlecuamehe").unwrap(),
            MethodNumber::new(796603392265069093)
        )
    }

    #[test]
    fn returns_hash() {
        assert_eq!(
            MethodNumber::from_str("natasharomanoff").unwrap(),
            MethodNumber::new(6905860632893337981)
        );
    }

    #[test]
    fn returns_proper_numbers_from_str() {
        assert_eq!(
            MethodNumber::from_str("a").unwrap(),
            MethodNumber::new(32783)
        );
        assert_eq!(MethodNumber::from_str("b").unwrap(), MethodNumber::new(196));
        assert_eq!(
            MethodNumber::from_str("c").unwrap(),
            MethodNumber::new(32884)
        );
        assert_eq!(
            MethodNumber::from_str("abc123").unwrap(),
            MethodNumber::new(691485674271)
        );
        assert_eq!(
            MethodNumber::from_str("spiderman").unwrap(),
            MethodNumber::new(311625498215)
        );
        assert_eq!(
            MethodNumber::from_str("brucewayne").unwrap(),
            MethodNumber::new(56488722015273161)
        );
        assert_eq!(
            MethodNumber::from_str("anthonystark").unwrap(),
            MethodNumber::new(50913722085663764)
        );
        assert_eq!(
            MethodNumber::from_str("natasharomanoff").unwrap(),
            MethodNumber::new(6905860632893337981)
        );
        assert_eq!(
            MethodNumber::from_str("abcdefghijklmnopqrstuvwxyz").unwrap(),
            MethodNumber::new(2393445670689189432)
        );
    }

    #[test]
    fn method_number_value_to_string_is_converted_successfully() {
        let name = MethodNumber::from_str("a").unwrap();
        assert_eq!(name.value, 32783);
        assert_eq!(name.to_string(), "a");

        let name = MethodNumber::from_str("b").unwrap();
        assert_eq!(name.to_string(), "b");
        let name = MethodNumber::from(196);
        assert_eq!(name.to_string(), "b");

        let name = MethodNumber::from_str("c").unwrap();
        assert_eq!(name.to_string(), "c");
        let name = MethodNumber::from(32884);
        assert_eq!(name.to_string(), "c");

        let name = MethodNumber::from_str("spiderman").unwrap();
        assert_eq!(name.to_string(), "spiderman");
        let name = MethodNumber::from(311625498215);
        assert_eq!(name.to_string(), "spiderman");

        let name = MethodNumber::from_str("anthonystark").unwrap();
        assert_eq!(name.to_string(), "anthonystark");
        let name = MethodNumber::from(50913722085663764);
        assert_eq!(name.to_string(), "anthonystark");

        let name = MethodNumber::from_str("natasharomanoff").unwrap();
        assert_eq!(name.to_string(), "#psaoryoiluhlrpyn");
        let name = MethodNumber::from(6905860632893337981);
        assert_eq!(name.to_string(), "#psaoryoiluhlrpyn");

        let name = MethodNumber::from(0);
        assert_eq!(name.to_string(), "");
    }

    #[test]
    fn case_sensitivity() {
        // regular compression ignores case
        let name = MethodNumber::from_str("A").unwrap();
        assert_eq!(name.value, 32783);

        // but weirdly, hash names are case sensitive
        let name = MethodNumber::from_str("NATASHAROMANOFF").unwrap();
        assert_eq!(name.value, 679355919866582572);
    }
}
