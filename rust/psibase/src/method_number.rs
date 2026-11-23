//! The canonical eight-byte action/event name type.
use crate::{serialize_as_str, Pack, ToKey, ToSchema, Unpack};
pub use psibase_names::ActionNameError as MethodNumberError;
use psibase_names::{action_name_from_str, action_name_to_string};
pub use psibase_names::{ActionNameError, ACTION_NAME_FORMAT_VERSION, ACTION_NAME_MODEL_SHA256};
use std::str::FromStr;

/// A contract action or event name encoded with the shared frozen model.
///
/// Text parsing is strict and fallible. Case folds to ASCII lowercase while
/// digits and underscores remain distinct. Long identifiers use hash fallback.
/// Numeric dispatch and fracpack representation remain exactly eight bytes.
#[derive(Debug, Default, PartialEq, Eq, Copy, Clone, Hash, Pack, Unpack, ToKey, ToSchema)]
#[repr(transparent)]
#[fracpack(
    definition_will_not_change,
    fracpack_mod = "fracpack",
    custom = "ActionName"
)]
#[to_key(psibase_mod = "crate")]
pub struct ActionName {
    pub value: u64,
}

/// Source spelling retained for consumers; it is the same type and codec.
pub use ActionName as MethodNumber;
#[allow(non_camel_case_types)]
pub type action_name = ActionName;

serialize_as_str!(ActionName, "action name");

impl ActionName {
    pub const MODEL_SHA256: &'static str = ACTION_NAME_MODEL_SHA256;
    pub const FORMAT_VERSION: &'static str = ACTION_NAME_FORMAT_VERSION;
    /// Construct from raw wire bits, including unknown IDs. Use `validate` when
    /// the caller needs canonical text rather than numeric dispatch.
    pub const fn new(value: u64) -> Self {
        Self { value }
    }
    pub fn try_from_raw(value: u64) -> Result<Self, ActionNameError> {
        Self::new(value).validate()
    }
    pub fn try_to_string(self) -> Result<String, ActionNameError> {
        action_name_to_string(self.value)
    }
    pub fn validate(self) -> Result<Self, ActionNameError> {
        action_name_to_string(self.value).map(|_| self)
    }
}
impl From<u64> for ActionName {
    fn from(value: u64) -> Self {
        Self { value }
    }
}
impl FromStr for ActionName {
    type Err = ActionNameError;
    fn from_str(name: &str) -> Result<Self, Self::Err> {
        action_name_from_str(name).map(Self::new)
    }
}
impl From<&str> for ActionName {
    fn from(name: &str) -> Self {
        Self::from_str(name).expect("invalid action name")
    }
}
impl std::fmt::Display for ActionName {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match action_name_to_string(self.value) {
            Ok(name) => f.write_str(&name),
            Err(_) => write!(f, "<invalid-action-name:{:016x}>", self.value),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use fracpack::Pack;
    #[test]
    fn type_is_eight_bytes_and_alias_is_same_type() {
        assert_eq!(std::mem::size_of::<ActionName>(), 8);
        let name: MethodNumber = ActionName::from("getData");
        assert_eq!(name.to_string(), "getdata");
        assert_eq!(name.packed().len(), 8);
        assert_eq!(name.validate().unwrap(), name);
    }
    #[test]
    fn invalid_names_are_errors_not_zero() {
        for name in ["", "?", "what?", "?what", "get-data", "1get", "é", "#short"] {
            assert!(name.parse::<ActionName>().is_err(), "{name}");
            assert!(serde_json::from_value::<ActionName>(serde_json::json!(name)).is_err());
        }
    }
    #[test]
    fn complete_id_round_trip() {
        for name in [
            "hello",
            "requestRecovery",
            "registerEventIndex",
            "foo_bar",
            "foo0",
            "cpu_blocks_avg",
            "set_guild_weight_curve",
            "#ffffffffffffffff",
        ] {
            let value: ActionName = name.parse().unwrap();
            assert_eq!(value.to_string().parse::<ActionName>().unwrap(), value);
            let json = serde_json::to_string(&value).unwrap();
            assert_eq!(serde_json::from_str::<ActionName>(&json).unwrap(), value);
        }
        assert_ne!(ActionName::from("foo_bar"), ActionName::from("fooqbar"));
        assert_ne!(ActionName::from("load0"), ActionName::from("loado"));
    }
    #[test]
    fn unset_and_unknown_raw_ids_do_not_panic_in_diagnostics() {
        assert_eq!(
            ActionName::default().to_string(),
            "<invalid-action-name:0000000000000000>"
        );
        assert!(ActionName::default().validate().is_err());
        assert_eq!(ActionName::new(0).packed(), vec![0; 8]);
        let _ = ActionName::new(1).to_string();
    }
}
