//! This is the example from the book, but loaded with
//! doc strings to test the [psibase::service] macro's
//! handling of them.

/// This service adds and multiplies `i32` numbers.
///
/// This is where a detailed description would go.
#[psibase::service(name = "example")]
mod service {
    use psibase::*;

    /// Add two numbers together.
    ///
    /// See also [Self::multiply].
    #[action]
    fn add(a: i32, b: i32) -> i32 {
        a + b
    }

    /// Multiplies two numbers together.
    ///
    /// See also [Self::add].
    #[action]
    fn multiply(a: i32, b: i32) -> i32 {
        a * b
    }

    /// Runs `count` generated cases of one 128-bit operation and returns
    /// the high and low word of each result. See [crate::wide] for the
    /// operations and the case generator.
    #[action]
    fn wide(op: u8, seed: u64, count: u32) -> Vec<u64> {
        let mut state = seed;
        let mut out = Vec::with_capacity(2 * count as usize);
        for _ in 0..count {
            let [a_hi, a_lo, b_hi, b_lo] = crate::wide::case(&mut state);
            let r = crate::wide::apply(op, a_hi, a_lo, b_hi, b_lo);
            out.push((r >> 64) as u64);
            out.push(r as u64);
        }
        out
    }

    #[action]
    #[allow(non_snake_case)]
    fn serveSys(request: HttpRequest) -> Option<HttpReply> {
        serve_simple_ui::<Wrapper>(&request)
    }
}

/// 128-bit arithmetic as the compiler generates it for a service.
///
/// Services are built with the wasm wide-arithmetic feature when the compiler
/// is new enough (see cargo-psibase), which turns these operations into
/// `i64.add128`, `i64.sub128` and `i64.mul_wide_s/u`. One rustc release
/// generated wrong code for them. The test below runs each operation inside
/// the service and checks the answers against arithmetic done in 32-bit limbs,
/// which does not use those instructions.
pub mod wide {
    pub const ADD: u8 = 0;
    pub const SUB: u8 = 1;
    pub const MUL: u8 = 2;
    pub const MUL_WIDE_U: u8 = 3;
    pub const MUL_WIDE_S: u8 = 4;
    pub const DIV: u8 = 5;
    pub const REM: u8 = 6;

    const EDGES: [u64; 12] = [
        0,
        1,
        2,
        0xffff_ffff,
        0x1_0000_0000,
        0x7fff_ffff_ffff_ffff,
        0x8000_0000_0000_0000,
        0x8000_0000_0000_0001,
        0xffff_ffff_0000_0000,
        0xffff_ffff_ffff_fffe,
        0xffff_ffff_ffff_ffff,
        0x0123_4567_89ab_cdef,
    ];

    fn next(state: &mut u64) -> u64 {
        // splitmix64
        *state = state.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut z = *state;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        z ^ (z >> 31)
    }

    fn word(state: &mut u64) -> u64 {
        let r = next(state);
        if r & 1 == 0 {
            EDGES[((r >> 1) % EDGES.len() as u64) as usize]
        } else {
            next(state)
        }
    }

    /// The next case: `[a_hi, a_lo, b_hi, b_lo]`. `b` is never zero.
    pub fn case(state: &mut u64) -> [u64; 4] {
        let mut c = [word(state), word(state), word(state), word(state)];
        if c[2] == 0 && c[3] == 0 {
            c[3] = 1;
        }
        c
    }

    #[inline(never)]
    pub fn apply(op: u8, a_hi: u64, a_lo: u64, b_hi: u64, b_lo: u64) -> u128 {
        let a = ((a_hi as u128) << 64) | a_lo as u128;
        let b = ((b_hi as u128) << 64) | b_lo as u128;
        match op {
            ADD => a.wrapping_add(b),
            SUB => a.wrapping_sub(b),
            MUL => a.wrapping_mul(b),
            MUL_WIDE_U => (a_lo as u128) * (b_lo as u128),
            MUL_WIDE_S => ((a_lo as i64 as i128) * (b_lo as i64 as i128)) as u128,
            DIV => a / b,
            REM => a % b,
            _ => panic!("unknown operation"),
        }
    }
}

#[cfg(test)]
mod wide_reference {
    //! 128-bit values as four 32-bit limbs, least significant first.
    pub type Limbs = [u32; 4];

    pub fn limbs(hi: u64, lo: u64) -> Limbs {
        [lo as u32, (lo >> 32) as u32, hi as u32, (hi >> 32) as u32]
    }

    pub fn add(a: Limbs, b: Limbs) -> Limbs {
        let mut r = [0u32; 4];
        let mut carry = 0u64;
        for i in 0..4 {
            let t = a[i] as u64 + b[i] as u64 + carry;
            r[i] = t as u32;
            carry = t >> 32;
        }
        r
    }

    pub fn neg(a: Limbs) -> Limbs {
        add([!a[0], !a[1], !a[2], !a[3]], [1, 0, 0, 0])
    }

    pub fn sub(a: Limbs, b: Limbs) -> Limbs {
        add(a, neg(b))
    }

    /// The low 128 bits of the product.
    pub fn mul(a: Limbs, b: Limbs) -> Limbs {
        let mut r = [0u32; 4];
        for i in 0..4 {
            let mut carry = 0u64;
            for j in 0..4 - i {
                let t = a[i] as u64 * b[j] as u64 + r[i + j] as u64 + carry;
                r[i + j] = t as u32;
                carry = t >> 32;
            }
        }
        r
    }

    pub fn less(a: Limbs, b: Limbs) -> bool {
        for i in (0..4).rev() {
            if a[i] != b[i] {
                return a[i] < b[i];
            }
        }
        false
    }
}

#[psibase::test_case(packages("test_contract"))]
fn wide_arithmetic(chain: psibase::Chain) -> Result<(), psibase::Error> {
    use psibase::*;
    use wide_reference::*;
    const SEED: u64 = 0x5eed_0123_4567_89ab;
    const COUNT: u32 = 4000;

    let run = |op: u8| -> Result<Vec<Limbs>, psibase::Error> {
        let words = Wrapper::push(&chain).wide(op, SEED, COUNT).get()?;
        assert_eq!(words.len(), 2 * COUNT as usize);
        Ok(words.chunks(2).map(|w| limbs(w[0], w[1])).collect())
    };
    let sum = run(wide::ADD)?;
    let difference = run(wide::SUB)?;
    let product = run(wide::MUL)?;
    let wide_u = run(wide::MUL_WIDE_U)?;
    let wide_s = run(wide::MUL_WIDE_S)?;
    let quotient = run(wide::DIV)?;
    let remainder = run(wide::REM)?;

    let mut state = SEED;
    for i in 0..COUNT as usize {
        let [a_hi, a_lo, b_hi, b_lo] = wide::case(&mut state);
        let (a, b) = (limbs(a_hi, a_lo), limbs(b_hi, b_lo));
        let case = format!("case {i}: a={a_hi:016x}{a_lo:016x} b={b_hi:016x}{b_lo:016x}");

        assert_eq!(sum[i], add(a, b), "add, {case}");
        assert_eq!(difference[i], sub(a, b), "sub, {case}");
        assert_eq!(product[i], mul(a, b), "mul, {case}");
        assert_eq!(wide_u[i], mul(limbs(0, a_lo), limbs(0, b_lo)), "unsigned widening mul, {case}");

        // Sign-extend each operand to 128 bits; the low 128 bits of that
        // product are the signed 64x64 product.
        let extend = |x: u64| limbs(if (x as i64) < 0 { u64::MAX } else { 0 }, x);
        assert_eq!(wide_s[i], mul(extend(a_lo), extend(b_lo)), "signed widening mul, {case}");

        // a == q * b + r with r < b and q * b <= a identifies q and r.
        assert!(less(remainder[i], b), "remainder not below divisor, {case}");
        assert_eq!(add(mul(quotient[i], b), remainder[i]), a, "div/rem, {case}");
        assert!(!less(a, mul(quotient[i], b)), "quotient too large, {case}");
    }
    Ok(())
}

#[psibase::test_case(packages("test_contract"))]
fn test1(chain: psibase::Chain) -> Result<(), psibase::Error> {
    use psibase::*;
    assert_eq!(Wrapper::push(&chain).add(3, 4).get()?, 7);
    assert_eq!(Wrapper::push(&chain).multiply(3, 4).get()?, 12);

    println!("{}", Wrapper::push(&chain).add(9, 8).trace);

    Ok(())
}

#[test]
fn dump_schema() {
    use psibase::*;
    let s = serde_json::to_string_pretty(&create_schema::<Wrapper>()).unwrap();
    println!("{}", s);
}

#[test]
fn dump_templates() {
    use psibase::*;
    println!("{}", generate_action_templates::<Wrapper>());
}
