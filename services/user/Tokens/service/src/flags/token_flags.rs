use psibase::abort_message;

use super::BitFlags;

#[repr(u8)]
#[derive(PartialEq)]
pub enum TokenSettingIndex {
    Unburnable = 0,
    Untransferable = 1,
    Unrecallable = 2,
}

impl From<u8> for TokenSettingIndex {
    fn from(value: u8) -> Self {
        if value > 2 {
            panic!("index out of bounds")
        }
        TokenSettingIndex::from(value)
    }
}
pub struct TokenSetting {
    pub value: u8,
}

impl BitFlags for TokenSetting {
    fn value(&self) -> u8 {
        self.value
    }

    fn set_value(&mut self, value: u8) {
        self.value = value;
    }
}

impl TokenSetting {
    pub fn new() -> Self {
        Self { value: 0 }
    }

    pub fn is_unburnable(&self) -> bool {
        self.is_set(1u8 << TokenSettingIndex::Unburnable as u8)
    }

    pub fn is_untransferable(&self) -> bool {
        self.is_set(1u8 << TokenSettingIndex::Untransferable as u8)
    }

    pub fn is_unrecallable(&self) -> bool {
        self.is_set(1u8 << TokenSettingIndex::Unrecallable as u8)
    }

    pub fn set_index(&mut self, index: TokenSettingIndex, enabled: bool) {
        if TokenSettingIndex::Unrecallable == index && self.is_unrecallable() {
            abort_message("cannot mutate unrecallable setting once set");
        }
        self.set(index as u8, enabled);
    }
}

impl From<u8> for TokenSetting {
    fn from(value: u8) -> Self {
        TokenSetting { value }
    }
}
