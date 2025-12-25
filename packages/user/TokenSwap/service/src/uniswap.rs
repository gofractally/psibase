use psibase::{check, services::tokens::Quantity};

pub const PPM: u32 = 1_000_000;

pub fn swap(
    incoming_amount: Quantity,
    incoming_reserve: Quantity,
    outgoing_reserve: Quantity,
    fee_ppm: u32,
) -> Quantity {
    let incoming_amount = incoming_amount.value as u128;
    let incoming_reserve = incoming_reserve.value as u128;
    let outgoing_reserve = outgoing_reserve.value as u128;

    check(
        incoming_amount > 0 && incoming_reserve > 0 && outgoing_reserve > 0,
        "zero input or reserve",
    );

    let incoming_after_fee = incoming_amount
        .checked_mul((PPM - fee_ppm) as u128)
        .and_then(|v| v.checked_div(PPM as u128))
        .unwrap_or(0);

    check(
        incoming_after_fee > 0,
        "incoming amount too small after fee",
    );

    let numerator = outgoing_reserve
        .checked_mul(incoming_after_fee)
        .expect("numerator overflow");

    let denominator = incoming_reserve
        .checked_add(incoming_after_fee)
        .expect("denominator overflow");

    let amount_out = numerator / denominator;
    check(amount_out > 0, "zero output amount");

    (amount_out as u64).into()
}

pub fn share_of_lp_tokens(
    reserve_contribution: Quantity,
    reserve_balance: Quantity,
    total_liquidity: Quantity,
) -> Quantity {
    ((reserve_contribution.value as u128 * total_liquidity.value as u128
        / reserve_balance.value as u128) as u64)
        .into()
}

pub fn sqrt(n: u128) -> u128 {
    if n < 2 {
        return n;
    }

    let mut x = n;
    let mut y = (x + 1) >> 1;

    while y < x {
        x = y;
        y = (x + n / x) >> 1;
    }

    x
}

pub fn mul_div(a: Quantity, b: Quantity, c: Quantity) -> Quantity {
    let res = (a.value as u128 * b.value as u128) / (c.value as u128);
    (res as u64).into()
}
