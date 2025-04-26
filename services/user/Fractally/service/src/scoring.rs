use core::panic;

use psibase::Error;

pub fn calculate_ema(new_level: u8, previous_ema: f32, alpha: f32) -> Result<f32, Error> {

    if new_level < 1 || new_level > 6 {
        panic!("throw the damn error, Level must be between 1 and 6");
    }

    Ok(alpha * (new_level as f32) + (1.0 - alpha) * previous_ema)
}
