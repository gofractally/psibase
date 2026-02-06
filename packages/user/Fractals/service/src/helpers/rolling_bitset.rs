/// Fixed-size 16-bit container that behaves like a left-shifting ring / window.
/// - New bits are inserted at the LSB (bit 0).
/// - Existing bits shift left on insertion; oldest bit (bit 15) is discarded.
/// - Useful for tracking recent boolean states, patterns, or flags in a compact form.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct RollingBits16(u16);

impl RollingBits16 {
    /// Creates a new empty instance (all bits 0).
    pub const fn new() -> Self {
        Self(0)
    }

    /// Inserts a new bit at the LSB and shifts older bits left.
    /// Returns `self` for chaining.
    pub fn push(mut self, bit: bool) -> Self {
        self.0 = (self.0 << 1) | (bit as u16);
        self
    }

    /// Queries the bit from `positions_ago` steps back.
    /// - `0` = most recently pushed bit (LSB)
    /// - `15` = oldest bit still in the window
    pub fn get(self, positions_ago: usize) -> bool {
        psibase::check(positions_ago < 16, "positions_ago must be in range 0..16");
        ((self.0 >> positions_ago) & 1) != 0
    }

    /// Counts the total number of 1-bits in the current window.
    pub fn count_ones(self) -> u16 {
        self.0.count_ones() as u16
    }

    /// Counts the number of 1-bits among the most recently pushed `n` bits.
    /// Panics if `n > 16`.
    pub fn count_recent_ones(self, n: usize) -> u16 {
        psibase::check(n <= 16, "n cannot exceed 16");
        if n == 0 {
            return 0;
        }
        let mask = if n == 16 { !0u16 } else { (1u16 << n) - 1 };
        (self.0 & mask).count_ones() as u16
    }

    /// Returns the raw underlying 16-bit value (for storage/serialization).
    pub const fn value(self) -> u16 {
        self.0
    }
}

impl From<u16> for RollingBits16 {
    fn from(value: u16) -> Self {
        Self(value)
    }
}

impl From<RollingBits16> for u16 {
    fn from(r: RollingBits16) -> u16 {
        r.0
    }
}
