

pub fn calculate_ema(new_score: f32, previous_score: f32, alpha: f32) -> f32 {
    alpha * new_score + (1.0 - alpha) * previous_score
}
