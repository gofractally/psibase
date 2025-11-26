pub fn fibonacci_binet_exact(n: u64) -> u64 {
    if n == 0 {
        return 0;
    }
    if n == 1 {
        return 1;
    }

    let phi = (1.0 + 5.0_f64.sqrt()) / 2.0;
    let psi = (1.0 - 5.0_f64.sqrt()) / 2.0; // conjugate
    let sqrt5 = 5.0_f64.sqrt();

    // Full Binet: F_n = (φ^n - ψ^n) / √5
    // Since |ψ| < 1, ψ^n is tiny for large n
    let term1 = phi.powi(n as i32);
    let term2 = psi.powi(n as i32);
    ((term1 - term2) / sqrt5).round() as u64
}
