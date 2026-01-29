use psibase::{check, services::tokens::Quantity};

pub fn sqrt(n: u128) -> u128 {
    check(n < u128::MAX, "Input too large for sqrt calculation");
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
