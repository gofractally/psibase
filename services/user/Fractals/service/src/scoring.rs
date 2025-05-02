use core::panic;

use psibase::Error;

pub fn calculate_ema(new_score: f32, previous_score: f32, alpha: f32) -> Result<f32, Error> {

    if new_score < 1.0 || new_score > 6.0 {
        panic!("Level must be between 1 and 6");
    }

    Ok(alpha * new_score + (1.0 - alpha) * previous_score)
}
