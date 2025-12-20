type Type = u16;

/// A rolling number bit activity tracker.
/// Newest event is stored in the least-significant bit (LSB).
/// Oldest bit automatically drops off after 8 entries.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct RollingBitset(Type);

impl RollingBitset {
    pub fn new() -> Self {
        Self(0)
    }

    /// Mark an event: true = set bit (1), false = clear bit (0)
    /// This shifts left and adds the new bit as the *least significant bit*
    pub fn mark(mut self, value: bool) -> Self {
        // Shift left and add new bit; oldest bit falls off naturally
        self.0 = (self.0 << 1) | (value as Type);
        self
    }

    /// Get the bit value for the last `n` events (0 = most recent, 1 = previous, etc.)
    /// Returns None if asking beyond recordable events
    pub fn get(&self, events_ago: Type) -> bool {
        let bit = (self.0 >> events_ago) & 1;
        bit != 0
    }

    /// How many of the last events are set (true)?
    pub fn count_set(&self) -> Type {
        self.0.count_ones() as Type
    }

    /// Raw type value (useful for storage in DB)
    pub fn value(&self) -> Type {
        self.0
    }
}

impl From<Type> for RollingBitset {
    fn from(value: Type) -> Self {
        Self(value)
    }
}
