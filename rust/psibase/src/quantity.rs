use crate::{serialize_as_str, Pack, Reflect, ToKey, Unpack};
use custom_error::custom_error;

#[derive(Debug, Default, PartialEq, Eq, Copy, Clone, Hash, Pack, Unpack, Reflect, ToKey)]
#[fracpack(definition_will_not_change, fracpack_mod = "fracpack")]
#[reflect(psibase_mod = "crate", custom_json = true)]
#[to_key(psibase_mod = "crate")]
pub struct Quantity {
    pub value: u64,
}

serialize_as_str!(Quantity, "quantity");
