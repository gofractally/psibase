use crate::bitflag::{self, BitflagSettings};

pub const AUTO_DEBIT: u8 = 1u8 << 0;
pub const KEEP_ZERO_BALANCES: u8 = 1u8 << 1;

struct TokenBalanceSetting {
    value: u8,
}

impl bitflag::BitflagSettings for TokenBalanceSetting {
    fn value(&self) -> u8 {
        self.value
    }

    fn set_value(&mut self, value: u8) {
        self.value = value;
    }
}

impl TokenBalanceSetting {
    pub fn is_auto_debit(&self) -> bool {
        self.is_set(AUTO_DEBIT)
    }

    pub fn set_auto_debit(&mut self, enabled: bool) {
        self.set(AUTO_DEBIT, enabled);
    }
}

impl From<u8> for TokenBalanceSetting {
    fn from(value: u8) -> Self {
        TokenBalanceSetting { value }
    }
}
