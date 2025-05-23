pub trait BitflagSettings {
    fn value(&self) -> u8;
    fn set_value(&mut self, value: u8);

    fn set(&mut self, index: u8, enabled: bool) {
        if index < 8 {
            let current = self.value();
            if enabled {
                self.set_value(current | (1 << index));
            } else {
                self.set_value(current & !(1 << index));
            }
        } else {
            panic!("invalid index");
        }
    }

    fn is_set(&self, index: u8) -> bool {
        if index < 8 {
            (self.value() & (1 << index)) != 0
        } else {
            false
        }
    }
}
