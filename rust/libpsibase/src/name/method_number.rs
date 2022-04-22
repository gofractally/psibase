use super::constants::*;
use super::method_to_number_converter::MethodToNumberConverter;
use super::number_to_account_converter::NumberToAccountConverter;
use std::{num::ParseIntError, str::FromStr};

#[derive(Debug, Default, PartialEq)]
pub struct MethodNumber {
    pub value: u64,
}

impl MethodNumber {
    pub fn new(value: u64) -> Self {
        MethodNumber { value }
    }

    fn parse_hash(s: &str) -> Option<u64> {
        let mut chars = s.bytes();

        let first_char = chars.next().unwrap();
        if first_char != b'#' || s.len() != 17 {
            return None;
        }

        let mut output: u64 = 0;

        let mut i = 1;

        while let Some(c) = chars.next() {
            let mut sym = (CHAR_TO_SYMBOL_METHOD[c as usize] - 1) as u64;
            sym <<= 4 * (i - 1);
            output |= sym;
            i += 1;
        }

        return Some(output);
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
        if s.is_empty() {
            return Ok(MethodNumber::default());
        }

        let value =
            MethodNumber::parse_hash(s).unwrap_or_else(|| MethodToNumberConverter::convert(s));
        Ok(MethodNumber { value })
    }
}

impl std::fmt::Display for MethodNumber {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        if self.value == 0 {
            return f.write_str(""); // TODO: review impl empty string
        }

        f.write_str(NumberToAccountConverter::convert(self.value).as_str())
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
    }

    #[test]
    fn returns_hash() {
        assert_eq!(
            MethodNumber::from_str("natasharomanoff").unwrap(),
            MethodNumber::new(13346021867974402139)
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
            MethodNumber::new(13346021867974402139)
        );
    }

    // #[test]
    // fn method_number_value_to_string_is_converted_successfully() {
    //     let name = MethodNumber::from_str("a").unwrap();
    //     assert_eq!(name.value, 32783);
    //     assert_eq!(name.to_string(), "a");

    //     let name = MethodNumber::from_str("b").unwrap();
    //     assert_eq!(name.to_string(), "b");
    //     let name = MethodNumber::from(196);
    //     assert_eq!(name.to_string(), "b");

    //     let name = MethodNumber::from_str("c").unwrap();
    //     assert_eq!(name.to_string(), "c");
    //     let name = MethodNumber::from(32884);
    //     assert_eq!(name.to_string(), "c");

    //     let name = MethodNumber::from_str("abc123").unwrap();
    //     assert_eq!(name.to_string(), "abc123");
    //     let name = MethodNumber::from(311625498215);
    //     assert_eq!(name.to_string(), "abc123");

    //     let name = MethodNumber::from_str("spiderman").unwrap();
    //     assert_eq!(name.to_string(), "spiderman");
    //     let name = MethodNumber::from(311625498215);
    //     assert_eq!(name.to_string(), "spiderman");

    //     let name = MethodNumber::from_str("anthonystark").unwrap();
    //     assert_eq!(name.to_string(), "anthonystark");
    //     let name = MethodNumber::from(50913722085663764);
    //     assert_eq!(name.to_string(), "anthonystark");

    //     let name = MethodNumber::from_str("natasharomanoff").unwrap();
    //     assert_eq!(name.to_string(), "natasharomanoff");
    //     let name = MethodNumber::from(13346021867974402139);
    //     assert_eq!(name.to_string(), "natasharomanoff");

    //     let name = MethodNumber::from(0);
    //     assert_eq!(name.to_string(), "");
    // }
}
