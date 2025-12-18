//! ### Algorithm derivation (fixed-point Binet approximation)
//!
//! We want a *continuous* Fibonacci function based on the usual Binet-style
//! approximation
//!
//! \\[
//! F(x) \approx \frac{\varphi^x}{\sqrt{5}}
//! \quad\text{with}\quad
//! \varphi = \frac{1 + \sqrt{5}}{2}
//! \\]
//!
//! In particular, we intentionally use only the leading \\(\varphi^x/\sqrt{5}\\)
//! term from Binet's formula and discard the smaller \\(\psi^x/\sqrt{5}\\) term.
//! The reference implementation and tests in this crate are all written
//! against this one-term approximation.
//!
//! ---
//!
//! #### 1. Fixed-point representation
//!
//! Choose a global internal scale
//!
//! \\[
//! S = 10^{12}
//! \\]
//!
//! Any real number \\(r\\) is represented by an integer with this internal scale
//!
//! \\[
//! \tilde r = \mathrm{round}(r \cdot S), \qquad r \approx \tilde r / S
//! \\]
//!
//! ---
//!
//! #### 2. Rewriting \\(\varphi^x\\)
//!
//! We use the identity
//!
//! \\[
//! \varphi^x = \varphi^{\lfloor x \rfloor} \cdot \varphi^{x - \lfloor x \rfloor}
//! \\]
//!
//! This splits the exponent into:
//!
//! - an **integer part**, where exponentiation is exact and efficient, and  
//! - a **fractional part**, which remains in the interval \\([0, 1)\\).
//!
//! The fractional exponent is always small, so its exponential can be computed
//! with fewer Taylor terms and better accuracy.
//!
//! Let
//!
//! \\[
//! c_{\ln\varphi} = \ln \varphi,
//! \qquad
//! c_{1/\sqrt{5}} = \frac{1}{\sqrt{5}}
//! \\]
//!
//! We store these constants in scaled form:
//!
//! \\[
//! \widetilde{\ln\varphi} = \mathrm{round}(c_{\ln\varphi} \cdot S)
//! \qquad
//! \widetilde{1/\sqrt{5}} = \mathrm{round}(c_{1/\sqrt{5}} \cdot S)
//! \\]
//!
//! At runtime we never recompute logs or square-roots; we just use their
//! precomputed scaled integers.
//!
//! ---
//!
//! #### 3. Integer exponent via lookup table
//!
//! The integer portion of the exponent, \\(n = \lfloor x \rfloor\\), is handled by
//! precomputing a table of scaled values
//!
//! \\[
//! \widetilde{\varphi^{2^k}} = \mathrm{round}(\varphi^{2^k} \cdot S)
//! \\]
//!
//! for all powers of two needed to cover the full range of possible integer
//! exponents.
//!
//! ---
//!
//! #### 4. Fractional exponent via fixed-point `exp` (Taylor series)
//!
//! Let the fractional part be
//!
//! \\[
//! f = x - \lfloor x \rfloor \quad\text{with}\quad 0 \le f < 1
//! \\]
//!
//! Then
//!
//! \\[
//! \varphi^{f} = e^{f \ln\varphi}
//! \\]
//!
//! Since \\(f\\) is always in \\([0, 1)\\), the argument to the exponential is
//!
//! \\[
//! t = f \ln\varphi,
//! \qquad 0 \le t < \ln\varphi \approx 0.48
//! \\]
//!
//! In this crate we therefore only ever call the exponential with
//! \\(0 \le t \le \ln\varphi\\). This interval is small enough for the Taylor
//! expansion of \\(e^t\\) to converge rapidly.
//!
//! We compute a scaled value
//!
//! \\[
//! \widetilde{e^t} \approx e^t \cdot S
//! \\]
//!
//! using a truncated Taylor series, with \\(K = 11\\) terms. For our input
//! range, this achieves better than \\(10^{-4}\\) absolute error in the final
//! Fibonacci value.
//!
//! ---
//!
//! #### 5. Final combination and scaling
//!
//! The continuous Fibonacci approximation is then
//!
//! \\[
//! F(x)
//!   \approx \frac{\varphi^n}{\sqrt{5}}
//!           \cdot \varphi^{f}
//! \\]
//!
//! In fixed-point form:
//!
//! 1. compute \\(\widetilde{\varphi^n}\\) from the lookup table,  
//! 2. compute \\(\widetilde{e^t} \approx \widetilde{\varphi^f}\\),  
//! 3. multiply them in scale \\(S\\),  
//! 4. multiply by \\(\widetilde{1/\sqrt{5}}\\),  
//! 5. rescale from \\(S = 10^{12}\\) down to \\(10^4\\) for the public API.
//!
//! All runtime math uses only integer operations with explicit rounding, ensuring
//! deterministic behavior across platforms while still closely approximating the
//! continuous Binet formula.
//! 
//! ---
//!
//! #### 6. Error analysis
//!
//! For the fractional part we approximate
//!
//! \\[
//! e^t = \sum_{k=0}^{\infty} \frac{t^k}{k!}
//! \\]
//!
//! by truncating the series after \\(K\\) terms.
//!
//! The total error in the scaled value \\(\widetilde{e^t} \approx e^t \cdot S\\)
//! comes from three sources:
//!
//! 1. **Rounding when forming \\(t\\) (≈ \\(0.81/S\\))**
//!
//!    Because \\(t\\) is stored in fixed-point form at scale \\(S\\), its initial
//!    rounding error is at most \\(0.5/S\\). This translates into at most
//!
//!    \\[
//!    |\Delta e^t| \le e^{\ln\varphi} \frac{0.5}{S}
//!      = \varphi \frac{0.5}{S} \approx \frac{0.81}{S}
//!    \\]
//!
//! 2. **Rounding inside the Taylor recurrence (≈ \\(5.5/S\\))**
//!
//!    Each term in the recurrence
//!
//!    \\[
//!    \text{term}\_k = \text{round}\left(
//!        \frac{\text{term}\_{k-1} \cdot t}{k}
//!    \right)
//!    \\]
//!
//!    produces at most another \\(0.5/S\\) of rounding. Because the factor
//!    \\(t/k\\) is always less than \\(\ln\varphi\\), previously accumulated
//!    rounding does not grow without bound. Starting from zero error, the
//!    recurrence \\(e\_k \approx (t/k)\,e\_{k-1} + 0.5\\) quickly drives each
//!    \\(e\_k\\) toward about \\(0.5/S\\). Summed over \\(K\\) steps this gives
//!    an overall contribution of roughly \\(0.5K/S\\), with \\(K/S\\) as a
//!    simple worst-case bound. In this implementation with \\(K = 11\\), this
//!    corresponds to total error ≈ \\(5.5/S\\).
//! 
//! 3. **Truncation of the Taylor series (≈ \\(0.33/S\\))**
//!
//!    Stopping the series after \\(K\\) terms leaves a remainder bounded by
//!
//!    \\[
//!    \bigl|R_K(t)\bigr| \le e^{t} \frac{t^{K+1}}{(K+1)!}
//!    \\]
//!
//!    On our input range \\(0 \le t \le \ln\varphi\\) this gives the uniform
//!    bound
//!
//!    \\[
//!    \bigl|R_K(t)\bigr| \le \varphi \frac{(\ln\varphi)^{K+1}}{(K+1)!}
//!    \\]
//!
//!    As \\(K\\) increases this quantity shrinks very rapidly. In the 
//!    implementation we choose \\(K = 11\\), for which the worst-case
//!    truncation remainder is approximately \\(0.33/S\\).
//!
//! Therefore, the rounding error accumulated inside the \\(K\\)-step Taylor
//! recurrence provides the dominant contribution to the total error.


// Fixed-point scales
const S: u128 = 1_000_000_000_000; // 12 decimal places internal scale
pub const EXTERNAL_S: u128 = 10_000; // 4 decimal places
const MAX_INPUT_UNSCALED: u32 = 32;
const MAX_INPUT_SCALED: u32 = MAX_INPUT_UNSCALED * (EXTERNAL_S as u32); // Power of 2 (scaled) nearest to the max input for which the output is accurate.

/// Precomputed scaled integer for ln(φ)
/// ln(phi) * S ≈ 0.48121182505960347 * 1e12
const LN_PHI_S: u128 = 481_211_825_060;

/// Precomputed scaled integer for 1/√5
/// (1/sqrt(5)) * S ≈ 0.4472135954999579 * 1e12
const INV_SQRT5_S: u128 = 447_213_595_500;

// PHI_POW2_TABLE[k] ≈ φ^(2^k) * S, with S = 1e12
const PHI_POW2_TABLE: [u128; 7] = [
    1_618_033_988_750,                                    // k=0, 2^0  = 1
    2_618_033_988_750,                                    // k=1, 2^1  = 2
    6_854_101_966_250,                                    // k=2, 2^2  = 4
    46_978_713_763_748,                                   // k=3, 2^3  = 8
    2_206_999_546_896_146,                                // k=4, 2^4  = 16
    4_870_846_999_999_794_697,                            // k=5, 2^5  = 32
    23_725_150_497_407_000_000_000_000,                   // k=6, 2^6  = 64
];

/// Calculate the Fibonacci value for a given x in a continuous function
/// (rather than the typical discrete fib sequence).
///
/// # Arguments
///
/// * `x` - The input value scaled by 10_000, eg. (fib(1.4142) -> fib(14142))
pub fn continuous_fibonacci(x: u32) -> u64 {
    psibase::check(x <= MAX_INPUT_SCALED, "x out of bounds");

    // Split x into integer and fractional parts:
    let int_x: u32 = x / (EXTERNAL_S as u32);
    let frac_x_ext: u32 = x % (EXTERNAL_S as u32);

    // φ^n in fixed-point: φ^int_x * S
    let phi_int_scaled: u128 = phi_integer_power_scaled(int_x);

    // Fractional part f in internal scale:
    //
    // f_real = frac_x_ext / EXTERNAL_S
    // f_scaled = f_real * S = frac_x_ext * (S / EXTERNAL_S)
    let frac_scaled: u128 = (frac_x_ext as u128) * (S / EXTERNAL_S);

    // t = f * ln(phi), with everything in scale S:
    // t_scaled ≈ (LN_PHI_S * f_scaled) / S
    let t_scaled: u128 = mul_ratio_rounded(LN_PHI_S, frac_scaled, S);

    // exp_scaled ≈ exp(t_real) * S = φ^f * S
    let phi_frac_scaled: u128 = exp_taylor_scaled(t_scaled);

    // Combine integer and fractional exponent parts:
    // φ^x = φ^n * φ^f, all in fixed-point scale S.
    let phi_x_scaled: u128 = mul_ratio_rounded(phi_int_scaled, phi_frac_scaled, S);

    // fib_scaled ≈ φ^x / sqrt(5) * S
    let fib_scaled: u128 = mul_ratio_rounded(phi_x_scaled, INV_SQRT5_S, S);

    // Convert back to EXTERNAL_S scale with rounding.
    let factor = S / EXTERNAL_S;
    let result = div_rounded(fib_scaled, factor);

    result as u64
}

/// Computes φ^n in fixed-point, returning φ^n * S.
///
/// - `n` is the integer exponent
fn phi_integer_power_scaled(mut n: u32) -> u128 {
    // Start from 1.0 in scale S.
    let mut result: u128 = S;

    let mut bit_index: usize = 0;
    while n > 0 {
        if (n & 1) != 0 {
            // result *= φ^(2^bit_index), rescaled back to S.
            result = mul_ratio_rounded(result, PHI_POW2_TABLE[bit_index], S);
        }
        n >>= 1;
        bit_index += 1;
    }

    result
}

/// Multiply by a rational factor with rounding:
/// returns round(value * factor / denom).
fn mul_ratio_rounded(value: u128, factor: u128, denom: u128) -> u128 {
    let prod = value.saturating_mul(factor);
    div_rounded(prod, denom)
}

/// Unsigned integer division with rounding: round(numer / denom).
fn div_rounded(numer: u128, denom: u128) -> u128 {
    (numer + denom / 2) / denom
}

/// Computes exp(t) for a fixed-point argument, using a truncated Taylor series.
///
/// - Input `t` is a fixed-point value scaled by `S`, i.e. t_real = t / S.
/// - Return value is exp(t_real) scaled by `S`, i.e. ≈ exp(t_real) * S.
///
/// The series used is:
///
///     e^t ≈ Σ_{k=0}^{K} t^k / k!
fn exp_taylor_scaled(t: u128) -> u128 {
    const MAX_K: u32 = 11;

    let t_scaled = t;

    // term_0 = 1.0 -> scaled
    let mut term: u128 = S;
    let mut sum: u128 = term;

    // term_k_scaled = term_{k-1}_scaled * t_scaled / (k * S)
    let mut k: u32 = 1;
    while k <= MAX_K {
        let denom = (k as u128).saturating_mul(S);
        term = mul_ratio_rounded(term, t_scaled, denom);
        sum = sum.saturating_add(term);
        k += 1;
    }

    sum
}


#[cfg(test)]
mod tests {
    use super::*;

    fn from_fixed(y: u64) -> f64 {
        y as f64 / EXTERNAL_S as f64
    }

    fn fib_true(x: f64) -> f64 {
        let phi = (1.0 + 5.0_f64.sqrt()) / 2.0;
        (phi.powf(x)) / 5.0_f64.sqrt()
    }

    #[test]
    fn check_accuracy() {
        let max_x_scaled: u32 = 32 * (EXTERNAL_S as u32);
        // 1e-4 accuracy experimentally determined to break at input 37.381

        for x_scaled in 0..=max_x_scaled {
            let x = x_scaled as f64 / EXTERNAL_S as f64;

            let fx = from_fixed(continuous_fibonacci(x_scaled));
            let true_fx = fib_true(x);
            let err = (fx - true_fx).abs();

            assert!(
                err < 1e-4,
                "x_scaled={x_scaled}, x={x}, approx={fx}, true={true_fx}, err={err}"
            );
        }
    }
}
