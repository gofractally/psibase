use super::constants::*;
use super::frequency::NameFrequency;

#[derive(Debug)]
pub struct StringToNumberConverter {
    bit: u8,
    next_byte: u8,
    mask: u8,
    output: u64,
}

impl StringToNumberConverter {
    pub fn convert(name: &str) -> u64 {
        let extractor = StringToNumberConverter {
            bit: 0,
            next_byte: 0,
            mask: 0x80,
            output: 0,
        };
        extractor.to_64(name)
    }

    fn to_64(mut self, name: &str) -> u64 {
        let mut high: u32 = MAX_CODE;
        let mut low: u32 = 0;
        let mut pending_bits = 0;

        let mut name_model = NameFrequency::default();

        let mut name_bytes = name.bytes();

        for _ in 0..=name_bytes.len() {
            let c = name_bytes.next().unwrap_or(0);

            if self.bit >= 64 {
                break;
            }

            let char_symbol = CHAR_TO_SYMBOL[c as usize];

            let p = name_model.get_probability(char_symbol);
            if p.count == 0 {
                return 0; // logic error shouldn't happen
            }

            let range = high - low + 1;
            high = low + (range * p.high / p.count) - 1;
            low = low + (range * p.low / p.count);

            loop {
                if high < ONE_HALF {
                    self.put_bit_plus_pending(false, pending_bits);
                    pending_bits = 0;
                } else if low >= ONE_HALF {
                    self.put_bit_plus_pending(true, pending_bits);
                    pending_bits = 0;
                } else if low >= ONE_FOURTH && high < THREE_FOURTHS {
                    pending_bits += 1;
                    low -= ONE_FOURTH;
                    high -= ONE_FOURTH;
                } else {
                    break;
                }
                high <<= 1;
                high += 1;
                low <<= 1;
                high &= MAX_CODE;
                low &= MAX_CODE;
            }
        }

        pending_bits += 1;

        if low < ONE_FOURTH {
            self.put_bit_plus_pending(false, pending_bits);
        } else {
            self.put_bit_plus_pending(true, pending_bits);
        }

        if self.mask != 0x80 {
            if self.bit < 64 {
                self.output |= (self.next_byte as u64) << self.bit;
            } else {
                self.output = 0;
            }
        }

        self.output
    }

    fn put_bit_plus_pending(&mut self, bit: bool, pending_bits: u8) {
        let mut pending_bits = pending_bits;
        self.put_bit(bit);
        while pending_bits > 0 {
            self.put_bit(!bit);
            pending_bits -= 1;
        }
    }

    fn put_bit(&mut self, bit: bool) {
        if bit {
            self.next_byte |= self.mask;
        }
        self.mask >>= 1;
        if self.mask == 0 {
            if self.bit < 64 {
                self.output |= (self.next_byte as u64) << self.bit;
            }
            self.bit += 8;
            self.mask = 0x80;
            self.next_byte = 0;
        }
    }
}
