use super::constants::*;
use super::frequency::NameFrequency;

#[derive(Debug)]
pub struct NumberToStringConverter {
    current_byte: i32,
    last_mask: u8,
    not_eof: i32,
    input: u64,
}

impl NumberToStringConverter {
    pub fn convert<const CHARS: usize, const WIDTH: usize>(
        num: u64,
        model_cf: &[[u16; CHARS]; WIDTH],
        symbol_to_char: &[u8],
    ) -> String {
        let converter = NumberToStringConverter {
            current_byte: 0,
            last_mask: 1,
            not_eof: 64 + 16,
            input: num,
        };
        converter.to_string(model_cf, symbol_to_char)
    }

    fn to_string<const CHARS: usize, const WIDTH: usize>(
        mut self,
        model_cf: &[[u16; CHARS]; WIDTH],
        symbol_to_char: &[u8],
    ) -> String {
        let mut out = String::with_capacity(15);

        let mut high: u32 = MAX_CODE;
        let mut low: u32 = 0;
        let mut value: u32 = 0;

        let mut name_model = NameFrequency::new(model_cf);

        for _ in 0..CODE_VALUE_BITS {
            value <<= 1;
            if self.get_bit() {
                value += 1
            }
        }

        while self.not_eof > 0 {
            let range = high - low + 1;

            if range == 0 {
                return String::from("RUNTIME LOGIC ERROR");
            }

            let scaled_value = ((value - low + 1) * name_model.get_count() - 1) / range;
            let (p, c) = name_model.get_char(scaled_value);
            if c == 0 {
                break;
            }

            out.push(symbol_to_char[c as usize] as char);

            if p.count == 0 {
                return String::from("RUNTIME LOGIC ERROR");
            }

            high = low + (range * p.high) / p.count - 1;
            low = low + (range * p.low) / p.count;

            while self.not_eof > 0 {
                if high < ONE_HALF {
                    // do nothing, bit is a zero
                } else if low >= ONE_HALF {
                    // subtract one half from all three code values
                    value -= ONE_HALF;
                    low -= ONE_HALF;
                    high -= ONE_HALF;
                } else if low >= ONE_FOURTH && high < THREE_FOURTHS {
                    value -= ONE_FOURTH;
                    low -= ONE_FOURTH;
                    high -= ONE_FOURTH;
                } else {
                    break;
                }

                low <<= 1;
                high <<= 1;
                high += 1;
                value <<= 1;

                if self.get_bit() {
                    value += 1
                }
            }
        }

        out
    }

    fn get_bit(&mut self) -> bool {
        if self.last_mask == 1 {
            self.current_byte = (self.input & 0xff) as i32;
            self.input >>= 8;
            self.last_mask = 0x80;
        } else {
            self.last_mask >>= 1;
        }
        self.not_eof -= 1;

        (self.current_byte & self.last_mask as i32) != 0
    }
}
