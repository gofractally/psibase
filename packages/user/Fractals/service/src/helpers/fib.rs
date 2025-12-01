/// ### Algorithm derivation
/// 
/// We want a *continuous* Fibonacci function based on the usual Binet-style
/// approximation using fixed-point integer arithmetic.
/// 
/// \[
/// F(x) \approx \frac{\varphi^x}{\sqrt{5}}
/// \quad\text{with}\quad
/// \varphi = \frac{1 + \sqrt{5}}{2}.
/// \]
/// 
/// To make this deterministic and avoid floating point at runtime, we implement
/// everything in fixed-point integer arithmetic.
/// 
/// ---
/// 
/// #### 1. Fixed-point representation
/// 
/// Choose a global internal scale
/// 
/// \[
/// S = 10^8.
/// \]
/// 
/// Any real number \(r\) is represented by an integer with this internal scale
/// 
/// \[
/// \tilde r = \mathrm{round}(r \cdot S), \qquad r \approx \tilde r / S.
/// \]
/// 
/// ---
/// 
/// #### 2. Rewriting \(\varphi^x\)
/// 
/// We rewrite the exponential term using `exp`:
/// 
/// \[
/// \varphi^x = e^{x \ln \varphi}.
/// \]
/// 
/// Let
/// 
/// \[
/// c_{\ln\varphi} = \ln \varphi,
/// \qquad
/// c_{1/\sqrt{5}} = \frac{1}{\sqrt{5}}.
/// \]
/// 
/// We store these constants in scaled form:
/// 
/// \[
/// \widetilde{\ln\varphi} = \mathrm{round}(c_{\ln\varphi} \cdot S),
/// \qquad
/// \widetilde{1/\sqrt{5}} = \mathrm{round}(c_{1/\sqrt{5}} \cdot S).
/// \]
/// 
/// At runtime we never recompute logs or square-roots; we just use their
/// precomputed scaled integers.
/// 
/// ---
/// 
/// #### 3. Computing \(y = x \ln \varphi\) in fixed-point
/// 
/// The real value is
/// 
/// \[
/// y = x \ln \varphi.
/// \]
/// 
/// Using the scaled representations
/// 
/// \[
/// x \approx \tilde x / S,
/// \qquad
/// \ln \varphi \approx \widetilde{\ln\varphi} / S,
/// \]
/// 
/// we have
/// 
/// \[
/// y \approx \left(\frac{\widetilde{\ln\varphi}}{S}\right)
///            \left(\frac{\tilde x}{S}\right)
///     = \frac{\widetilde{\ln\varphi} \cdot \tilde x}{S^2}.
/// \]
/// 
/// We also want a scaled version of \(y\),
/// 
/// \[
/// \tilde y \approx y \cdot S,
/// \]
/// 
/// so
/// 
/// \[
/// \tilde y
///   \approx \frac{\widetilde{\ln\varphi} \cdot \tilde x}{S}.
/// \]
/// 
/// ---
/// 
/// #### 4. Fixed-point `exp` via Taylor series
/// 
/// We now need \(e^y\) where \(y = \tilde y / S\).
/// Define
/// 
/// \[
/// t = y,
/// \qquad
/// \tilde t = t \cdot S = \tilde y.
/// \]
/// 
/// The Taylor series for the exponential is
/// 
/// \[
/// e^t = \sum_{k=0}^{\infty} \frac{t^k}{k!}.
/// \]
/// 
/// We truncate this to some finite \(K\) (e.g. \(K = 25\)) and compute the terms
/// iteratively.
/// 
/// The scaled approximation of \(e^t\) is
/// 
/// \[
/// \widetilde{e^t}
///   \approx e^t \cdot S.
/// \]
/// 
/// For our usage (\(t = x \ln\varphi\) with \(x\) in a moderate range) and
/// `S = 1e8`, `K = 25` is enough to get less than \(10^{-4}\) absolute error in
/// the final Fibonacci value.
/// 
/// ---
/// 
/// #### 5. Summary
/// 
/// - Represent all reals as integers scaled by \(S = 10^8\).
/// - Rewrite the continuous Fibonacci approximation as
/// 
///   \[
///   F(x) \approx \frac{e^{x \ln\varphi}}{\sqrt{5}}.
///   \]
/// 
/// - Precompute scaled constants \(\widetilde{\ln\varphi}\) and
///   \(\widetilde{1/\sqrt{5}}\).
/// - For an input `x_times_1e4`, convert to internal scale, compute
/// 
///   - `y_scaled ≈ (x * ln(phi)) * S`,
///   - `exp_scaled ≈ exp(y) * S` via the truncated Taylor series above,
///   - `fib_scaled ≈ exp_scaled * (1/sqrt(5))`.
/// 
/// - Finally, convert `fib_scaled` from scale `S` to scale `10^4` and return it.
/// 
/// All runtime math is integer-only, so the algorithm is deterministic across platforms while still
/// closely approximating the continuous Binet formula
/// \(\displaystyle F(x) \approx \varphi^x / \sqrt{5}\).

/// Precomputed scaled integer for ln(φ)
/// ~ 0.48121183 at scale 1e8
const LN_PHI_S: u128 = 48_121_183;

/// Precomputed scaled integer for 1/√5
/// ~ 0.44721360 at scale 1e8
const INV_SQRT5_S: u128 = 44_721_360;

// Internal fixed-point scales
const S: u128 = 100_000_000; // 8 decimal places
const EXTERNAL_S: u128 = 10_000; // 4 decimal places

/// Calculate the Fibonacci value for a given x in a continuous function
/// (rather than the typical discrete fib sequence).
///
/// # Arguments
///
/// * `x` - The input value scaled by 10_000, eg. (fib(1.4142) -> 14142)
pub fn continuous_fibonacci(x: u32) -> u64 {
    // Convert external EXTERNAL_S-scaled x to internal S-scaled x.
    let x: u128 = (x as u128) * (S / EXTERNAL_S);

    // y_scaled ≈ (x * ln(phi)) * S  (still scaled by S)
    let y_scaled = mul_ratio_rounded(LN_PHI_S, x, S);

    // exp_scaled ≈ exp(x * ln(phi)) * S = φ^x * S
    let exp_scaled = exp_taylor_scaled(y_scaled);

    // fib_scaled ≈ φ^x / sqrt(5) * S
    let fib_scaled = mul_ratio_rounded(exp_scaled, INV_SQRT5_S, S);

    // Convert back to EXTERNAL_S scale with rounding.
    let factor = S / EXTERNAL_S; // 1e4
    let result = div_rounded(fib_scaled, factor);

    result as u64
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
    const MAX_K: u32 = 25;

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
        let max_x_scaled: u32 = 15 * (EXTERNAL_S as u32);

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
