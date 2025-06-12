use super::BitFlags;

pub const AUTO_DEBIT: u8 = 1u8 << 0;
pub const KEEP_ZERO_BALANCES: u8 = 1u8 << 1;

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
        self.is_set(AUTO_DEBIT)
    }

    pub fn set_is_auto_debit(&mut self, enabled: bool) {
        self.set(AUTO_DEBIT, enabled);
    }

    pub fn is_keep_zero_balances(&self) -> bool {
        self.is_set(KEEP_ZERO_BALANCES)
    }

    pub fn set_is_keep_zero_balances(&mut self, enabled: bool) {
        self.set(KEEP_ZERO_BALANCES, enabled);
    }
}

impl From<u8> for TokenHolderFlags {
    fn from(value: u8) -> Self {
        TokenHolderFlags { value }
    }
}
