pub fn calculate_ema(new_score: f32, previous_score: f32, alpha: f32) -> f32 {
    alpha * new_score + (1.0 - alpha) * previous_score
}

pub fn calculate_ema_u32(new_val: u32, prev_val: u32, alpha: Fraction) -> u32 {
    ema_u32_q(new_val, prev_val, alpha.to_q16())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Fraction {
    numerator: u32,
    denominator: u32,
}

impl Fraction {
    pub fn new(numerator: u32, denominator: u32) -> Self {
        assert!(denominator != 0, "denominator must be non-zero");
        Self {
            numerator,
            denominator,
        }
    }

    pub fn to_f32(self) -> f32 {
        self.numerator as f32 / self.denominator as f32
    }

    /// Converts the fraction to Q0.16 fixed-point (0‥=65 535)
    pub fn to_q16(self) -> u16 {
        const ONE_Q16: u64 = 65_536;
        let scaled: u64 = (self.numerator as u64) * ONE_Q16 / (self.denominator as u64);
        if scaled >= ONE_Q16 {
            //Values >=1.0 saturate
            65_535
        } else {
            scaled as u16
        }
    }
}

/// α is Q0.16 fixed‑point: 0..=65536  (e.g. α=0.25 -> 16384)
fn ema_u32_q(new_val: u32, prev_val: u32, alpha_q16: u16) -> u32 {
    const ONE_Q16: u64 = 65_536; // 2^16
    let a = alpha_q16 as u64;
    let inv = ONE_Q16 - a;

    debug_assert!(
        new_val <= 60_000 && prev_val <= 60_000,
        "new_val and prev_val must be at most 60_000"
    );

    // widening to avoid overflow
    let acc = a * new_val as u64 + inv * prev_val as u64;

    (acc >> 16) as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fraction_conversion() {
        let half = Fraction::new(1, 2);
        assert_eq!(half.to_q16(), 32_768);
        assert!((half.to_f32() - 0.5).abs() < f32::EPSILON);
    }

    #[test]
    fn test_ema_u32_frac() {
        let alpha = Fraction::new(1, 6);
        let new_val: f32 = 1.0;
        let prev_val: f32 = 6.0;
        let new_val_u32: u32 = 1000;
        let prev_val_u32: u32 = 6000;

        let float_result = calculate_ema(new_val, prev_val, alpha.to_f32());
        let fixed_result = calculate_ema_u32(new_val_u32, prev_val_u32, alpha);
        println!("\nfloat_result: {}", float_result);
        println!("fixed_result: {}", fixed_result);

        // Convert float_result (multiply by 1000) and compare (diff <= 1)
        let float_u32: u32 = (float_result * 1000.0) as u32;
        let diff = if fixed_result > float_u32 {
            fixed_result - float_u32
        } else {
            float_u32 - fixed_result
        };
        assert!(
            diff <= 1,
            "fixed result ({}) and float result ({} * 1000 = {}) differ by more than 1",
            fixed_result,
            float_result,
            float_u32
        );
    }
}
