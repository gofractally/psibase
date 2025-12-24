use psibase::{check, services::tokens::Quantity};

pub const PPM: u128 = 1_000_000;

pub fn swap(
    incoming_amount: Quantity,
    incoming_reserve: Quantity,
    outgoing_reserve: Quantity,
    fee_ppm: u128,
) -> Quantity {
    let incoming_amount = incoming_amount.value as u128;
    let incoming_reserve = incoming_reserve.value as u128;
    let outgoing_reserve = outgoing_reserve.value as u128;

    check(
        incoming_amount > 0 && incoming_reserve > 0 && outgoing_reserve > 0,
        "zero input or reserve",
    );

    let incoming_after_fee = (incoming_amount * (PPM - fee_ppm)) / PPM;
    check(
        incoming_after_fee > 0,
        "incoming amount too small after fee",
    );

    let numerator = outgoing_reserve
        .checked_mul(incoming_after_fee)
        .expect("numerator overflow");

    let denominator = incoming_reserve
        .checked_add(incoming_amount)
        .expect("denominator overflow");

    let amount_out = numerator / denominator;
    check(amount_out > 0, "zero output amount");

    (amount_out as u64).into()
}

pub fn quote(amount_in: Quantity, reserve_in: Quantity, reserve_out: Quantity) -> Quantity {
    if amount_in.value == 0 || reserve_in.value == 0 {
        return 0.into();
    }

    ((((amount_in.value as u128) * (reserve_out.value as u128)) / (reserve_in.value as u128))
        as u64)
        .into()
}

pub fn mul_div(a: Quantity, b: Quantity, denominator: Quantity) -> Quantity {
    (((a.value as u128 * b.value as u128) / (denominator.value as u128)) as u64).into()
}
