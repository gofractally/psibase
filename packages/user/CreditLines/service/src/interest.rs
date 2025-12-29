pub fn compute_compounded_balance(balance: i64, rate_ppm: u32, full_days: u32) -> i64 {
    if full_days == 0 || rate_ppm == 0 || balance == 0 {
        return balance;
    }
    let mut abs_balance = balance.abs() as i128;
    const SCALE: i128 = 1_000_000_000_000_000_000;
    const DAYS_PER_YEAR: i128 = 365;

    let daily_factor = SCALE + (rate_ppm as i128 * SCALE) / (1_000_000 * DAYS_PER_YEAR);
    for _ in 0..full_days {
        abs_balance = (abs_balance * daily_factor) / SCALE;
    }

    if balance > 0 {
        abs_balance as i64
    } else {
        -(abs_balance as i64)
    }
}
