use crate::bindings::exports::permissions::plugin::admin::{Descriptions, PromptContext};
use crate::bindings::exports::permissions::plugin::api::TrustLevel;
use psibase::fracpack::{FracInputStream, Pack, Result, Unpack};
use std::cmp::Ordering;

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

impl Ord for TrustLevel {
    fn cmp(&self, other: &Self) -> Ordering {
        (*self as u8).cmp(&(*other as u8))
    }
}

impl PartialOrd for TrustLevel {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some((*self as u8).cmp(&(*other as u8)))
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
        }
    }
}
