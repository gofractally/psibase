use crate::bindings::exports::permissions::plugin::admin::{Descriptions, PromptContext};
use crate::bindings::exports::permissions::plugin::api::TrustLevel;
use psibase::fracpack::{FracInputStream, Pack, Result, Unpack};

// Persisted permission bytes and WIT discriminants have always used this order.
// A generator/schema change must fail compilation rather than reinterpret it.
const _: () = {
    assert!(TrustLevel::None as u8 == 0);
    assert!(TrustLevel::Low as u8 == 1);
    assert!(TrustLevel::Medium as u8 == 2);
    assert!(TrustLevel::High as u8 == 3);
    assert!(TrustLevel::Max as u8 == 4);
};

impl From<u8> for TrustLevel {
    fn from(level: u8) -> Self {
        match level {
            0 => TrustLevel::None,
            1 => TrustLevel::Low,
            2 => TrustLevel::Medium,
            3 => TrustLevel::High,
            4 => TrustLevel::Max,
            _ => panic!("Invalid trust level: {}", level),
        }
    }
}

impl From<TrustLevel> for u8 {
    fn from(level: TrustLevel) -> Self {
        match level {
            TrustLevel::None => 0,
            TrustLevel::Low => 1,
            TrustLevel::Medium => 2,
            TrustLevel::High => 3,
            TrustLevel::Max => 4,
        }
    }
}

impl Default for TrustLevel {
    fn default() -> Self {
        TrustLevel::Max
    }
}

// Current wit-bindgen derives Ord for WIT enums. Authorization deliberately
// uses these explicit ranks instead, preserving the established None=0,
// Low=1, Medium=2, High=3, Max=4 policy across binding-generator versions.
pub fn trust_at_least(granted: TrustLevel, required: TrustLevel) -> bool {
    crate::trust_policy::at_least(u8::from(granted), u8::from(required))
}

pub fn higher_trust(left: TrustLevel, right: TrustLevel) -> TrustLevel {
    if trust_at_least(left, right) {
        left
    } else {
        right
    }
}

impl Pack for TrustLevel {
    const FIXED_SIZE: u32 = 1;
    const VARIABLE_SIZE: bool = false;
    fn pack(&self, dest: &mut Vec<u8>) {
        dest.push(*self as u8);
    }
}

impl<'a> Unpack<'a> for TrustLevel {
    const FIXED_SIZE: u32 = 1;
    const VARIABLE_SIZE: bool = false;
    fn unpack(src: &mut FracInputStream<'a>) -> Result<Self> {
        Ok(TrustLevel::from(u8::unpack(src)?))
    }
    fn verify(src: &mut FracInputStream) -> Result<()> {
        let _ = Self::unpack(src)?;
        Ok(())
    }
}

#[derive(Pack, Unpack)]
pub struct PackablePromptContext {
    pub user: String,
    pub caller: String,
    pub callee: String,
    pub level: TrustLevel,
    pub descriptions: Descriptions,
    // Internal only; never supplied by the consent UI. Missing old contexts
    // must fail decoding or the nonempty active-app validation.
    pub active_app: String,
}

impl From<PackablePromptContext> for PromptContext {
    fn from(context: PackablePromptContext) -> Self {
        PromptContext {
            user: context.user,
            caller: context.caller,
            callee: context.callee,
            level: context.level,
            descriptions: context.descriptions,
        }
    }
}

impl From<PromptContext> for PackablePromptContext {
    fn from(context: PromptContext) -> Self {
        PackablePromptContext {
            user: context.user,
            caller: context.caller,
            callee: context.callee,
            level: context.level,
            descriptions: context.descriptions,
            active_app: psibase_plugin::host::client::get_active_app(),
        }
    }
}
