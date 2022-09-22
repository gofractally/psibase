use super::constants::*;

#[derive(Debug)]
pub struct Probability {
    pub low: u32,
    pub high: u32,
    pub count: u32,
}

pub struct NameFrequency<'a, const CHARS: usize, const WIDTH: usize> {
    last_byte: u8,
    model_cf: &'a [[u16; CHARS]; WIDTH],
}

impl<'a, const CHARS: usize, const WIDTH: usize> NameFrequency<'a, CHARS, WIDTH> {
    pub fn new(model_cf: &'a [[u16; CHARS]; WIDTH]) -> Self {
        NameFrequency {
            last_byte: 0,
            model_cf,
        }
    }

    pub fn get_probability(&mut self, c: u8) -> Probability {
        let cumulative_frequency = self.model_cf[self.last_byte as usize];
        self.last_byte = c;
        Probability {
            low: cumulative_frequency[c as usize] as u32,
            high: cumulative_frequency[(c + 1) as usize] as u32,
            count: cumulative_frequency[WIDTH] as u32,
        }
    }

    pub fn get_count(&self) -> u32 {
        self.model_cf[self.last_byte as usize][WIDTH] as u32
    }

    pub fn get_char(&mut self, scaled_value: u32) -> (Probability, u8) {
        let cumulative_frequency = self.model_cf[self.last_byte as usize];

        for i in 0..WIDTH {
            if scaled_value >= cumulative_frequency[i + 1] as u32 {
                continue;
            }

            let mut c = i as u8;
            let p = Probability {
                low: cumulative_frequency[c as usize] as u32,
                high: cumulative_frequency[(c + 1) as usize] as u32,
                count: cumulative_frequency[WIDTH] as u32,
            };

            if p.count == 0 {
                c = CHAR_TO_SYMBOL[0];
                self.last_byte = c;
                return (
                    Probability {
                        low: 0,
                        high: 1,
                        count: 1,
                    },
                    c,
                );
            }

            self.last_byte = c;
            return (p, c);
        }

        (
            Probability {
                low: 0,
                high: 1,
                count: 1,
            },
            CHAR_TO_SYMBOL[0],
        )
    }
}
