use super::BitFlags;

pub const UNBURNABLE: u8 = 1u8 << 0;
pub const UNTRANSFERABLE: u8 = 1u8 << 1;
pub const UNRECALLABLE: u8 = 1u8 << 2;

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
        self.is_set(UNBURNABLE)
    }

    pub fn set_is_unburnable(&mut self, enabled: bool) {
        self.set(UNBURNABLE, enabled);
    }

    pub fn is_unrecallable(&self) -> bool {
        self.is_set(UNRECALLABLE)
    }

    pub fn set_is_unrecallable(&mut self, enabled: bool) {
        self.set(UNRECALLABLE, enabled);
    }

    pub fn is_untransferable(&self) -> bool {
        self.is_set(UNTRANSFERABLE)
    }

    pub fn set_is_untransferable(&mut self, enabled: bool) {
        self.set(UNTRANSFERABLE, enabled);
    }
}

impl From<u8> for TokenSetting {
    fn from(value: u8) -> Self {
        TokenSetting { value }
    }
}
