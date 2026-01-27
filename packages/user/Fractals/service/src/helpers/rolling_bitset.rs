/// A rolling 16-bit activity tracker.
/// Newest event → LSB. Oldest drops off after 16 events.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct RollingBitset(u16);

impl RollingBitset {
    pub const fn new() -> Self {
        Self(0)
    }

    pub fn mark(mut self, value: bool) -> Self {
        self.0 = (self.0 << 1) | (value as u16);
        self
    }

    /// Get event from the past (0 = most recent)
    pub fn get(self, events_ago: usize) -> bool {
        psibase::check(
            events_ago < 16,
            "events_ago must be in range 0..16 (max 15)",
        );
        ((self.0 >> events_ago) & 1) != 0
    }

    /// Total trues in entire history
    pub fn count_set(self) -> u16 {
        self.0.count_ones() as u16
    }

    /// How many of the last n events were true?
    pub fn count_last_n_set(self, n: usize) -> u16 {
        psibase::check(n <= 16, "n cannot exceed 16 for a 16-bit rolling bitset");
        if n == 0 {
            return 0;
        }
        let mask = if n == 16 { u16::MAX } else { (1u16 << n) - 1 };
        (self.0 & mask).count_ones() as u16
    }

    /// Raw value for DB storage
    pub const fn value(self) -> u16 {
        self.0
    }
}

impl From<u16> for RollingBitset {
    fn from(value: u16) -> Self {
        Self(value)
    }
}

impl From<RollingBitset> for u16 {
    fn from(b: RollingBitset) -> u16 {
        b.0
    }
}
