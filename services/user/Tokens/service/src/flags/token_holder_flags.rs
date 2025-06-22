use super::BitFlags;

#[repr(u8)]
#[derive(PartialEq)]
pub enum TokenHolderSettingIndex {
    Autodebit = 0,
    KeepZeroBalances = 1,
}

impl From<u8> for TokenHolderSettingIndex {
    fn from(value: u8) -> Self {
        if value > 1 {
            panic!("index out of bounds")
        }
        TokenHolderSettingIndex::from(value)
    }
}

pub struct TokenHolderFlags {
    pub value: u8,
}

impl BitFlags for TokenHolderFlags {
    fn value(&self) -> u8 {
        self.value
    }

    fn set_value(&mut self, value: u8) {
        self.value = value;
    }
}

impl TokenHolderFlags {
    pub fn new() -> Self {
        Self { value: 0 }
    }

    pub fn is_auto_debit(&self) -> bool {
        self.is_set(TokenHolderSettingIndex::Autodebit as u8)
    }

    pub fn is_keep_zero_balances(&self) -> bool {
        self.is_set(TokenHolderSettingIndex::KeepZeroBalances as u8)
    }

    pub fn set_index(&mut self, index: TokenHolderSettingIndex, enabled: bool) {
        self.set(index as u8, enabled);
    }
}

impl From<u8> for TokenHolderFlags {
    fn from(value: u8) -> Self {
        TokenHolderFlags { value }
    }
}
