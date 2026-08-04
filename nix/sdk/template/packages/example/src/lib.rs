#[psibase::service]
mod service {
    /// Add two integers.
    #[action]
    fn add(a: i32, b: i32) -> i32 {
        a + b
    }

    /// Multiply two integers.
    #[action]
    fn multiply(a: i32, b: i32) -> i32 {
        a * b
    }
}
