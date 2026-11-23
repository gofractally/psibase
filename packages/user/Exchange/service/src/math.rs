//! Checked integer financial primitives. All stored token amounts and sums are
//! <=2^40-1; K<2^80, K*C<2^120, D*a*(a+C)<2^121. No floats or wrapping.
pub const MAX: u64 = (1 << 40) - 1;
pub const Q: u128 = 1 << 40;
pub const MAX_PRICE: u64 = (1 << 32) - 1;
/// Fracpack deliberately has no primitive u128; persist two native u64 limbs.
#[derive(
    Clone,
    Copy,
    Debug,
    psio::PsszPack,
    psio::PsszUnpack,
    psio::PsszView,
    psio::ToPsszSchema,
    psio::JsonText,
    psio::Serde,
)]
pub struct Wide {
    pub lo: u64,
    pub hi: u64,
}
impl Wide {
    pub fn get(self) -> u128 {
        self.lo as u128 | ((self.hi as u128) << 64)
    }
}
impl From<u128> for Wide {
    fn from(n: u128) -> Self {
        Self {
            lo: n as u64,
            hi: (n >> 64) as u64,
        }
    }
}
impl std::fmt::Display for Wide {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.get())
    }
}
pub fn amount(n: u128) -> u64 {
    assert!(n <= MAX as u128, "market amount limit");
    n as u64
}
pub fn add(a: u64, b: u64) -> u64 {
    amount(a as u128 + b as u128)
}
pub fn mul(a: u64, b: u64) -> u64 {
    amount(a as u128 * b as u128)
}
pub fn ceil(a: u128, b: u128) -> u128 {
    assert!(b > 0, "division by zero");
    a / b + u128::from(a % b != 0)
}
pub fn sqrt(n: u128) -> u64 {
    let (mut lo, mut hi) = (0_u128, 1_u128 << 64);
    while lo + 1 < hi {
        let mid = (lo + hi) / 2;
        if mid <= n / mid {
            lo = mid
        } else {
            hi = mid
        }
    }
    lo as u64
}
pub fn trigger(k: u128, long: bool, p: u64, l: u64, t: u64) -> u64 {
    let h = book_trigger_raw(k, long, p, l, t);
    assert!(h > 0 && h <= MAX, "trigger reserve range");
    h
}
/// Spot prices beyond the current reserve range may rest until liquidity
/// changes. MAX is a safe stop, not permission to exceed the reserve bound.
pub fn book_trigger(k: u128, long: bool, p: u64, l: u64, t: u64) -> u64 {
    book_trigger_raw(k, long, p, l, t).min(MAX)
}
/// Existing armed stops can become unreachable after an LP product resize.
/// Keep their actual threshold above MAX rather than panicking or falsely
/// activating at the clamped reserve bound. New admission may remain strict.
pub fn stop_trigger(k: u128, long: bool, p: u64, l: u64, t: u64) -> u64 {
    book_trigger_raw(k, long, p, l, t)
}
fn book_trigger_raw(k: u128, long: bool, p: u64, l: u64, t: u64) -> u64 {
    assert!(p > 0 && p <= MAX_PRICE, "price range");
    let price = mul(p, t);
    let value = if long {
        k.checked_mul(l as u128).expect("trigger overflow") / price as u128
    } else {
        k.checked_mul(price as u128).expect("trigger overflow") / l as u128
    };
    sqrt(value)
}
pub fn recovery(k: u128, u: u64, c: u64) -> u64 {
    assert!(u > 0, "positive reserve");
    let end = add(u, c);
    amount(k.checked_mul(c as u128).expect("recovery overflow") / (u as u128 * end as u128))
}
pub fn relay(k: u128, u: u64, v: u64, input: u64) -> (u64, u64, u64) {
    assert!(input > 0, "positive input");
    let nu = add(u, input);
    let nv = amount(ceil(k, nu as u128));
    assert!(nv <= v, "relay output reserve");
    (nu, nv, v - nv)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn integer_bound_exhaustive() {
        for k in 1..300_u128 {
            for u in 1..50 {
                for c in 1..30 {
                    let v = ceil(k, u as u128) as u64;
                    let (_, _, out) = relay(k, u, v, c);
                    assert!(out >= recovery(k, u, c));
                }
            }
        }
    }
    #[test]
    fn shared_depth_not_counted_twice() {
        let k = 10000;
        assert_eq!(recovery(k, 100, 100), 50);
        assert_eq!(recovery(k, 200, 100), 16);
        assert_eq!(recovery(k, 100, 200), 66);
    }
    #[test]
    fn sqrt_edges() {
        for n in 0..10000 {
            let s = sqrt(n);
            assert!((s as u128) * (s as u128) <= n);
            assert!(((s + 1) as u128) * ((s + 1) as u128) > n);
        }
        assert_eq!(sqrt(u128::MAX), u64::MAX);
    }
    #[test]
    #[should_panic]
    fn reserves_bounded() {
        add(MAX, 1);
    }
    #[test]
    fn maximum_scratch() {
        let k = MAX as u128 * MAX as u128;
        assert!(k.checked_mul(MAX as u128).is_some());
        assert!((MAX as u128)
            .checked_mul(MAX as u128)
            .unwrap()
            .checked_mul(2 * MAX as u128)
            .is_some());
    }
}
