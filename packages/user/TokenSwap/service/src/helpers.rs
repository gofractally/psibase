use psibase::services::tokens::Quantity;

pub fn sqrt(n: u128) -> u128 {
    if n == u128::MAX {
        return u64::MAX as u128;
    }
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
