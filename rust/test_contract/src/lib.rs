//! This is the example from the book, but loaded with
//! doc strings to test the [psibase::service] macro's
//! handling of them.

/// This service adds and multiplies `i32` numbers.
///
/// This is where a detailed description would go.
#[psibase::service]
mod service {
    use psibase::*;

    /// Add two numbers together.
    ///
    /// See also [Self::multiply].
    #[action]
    fn add(a: i32, b: i32, _n: AccountNumber) -> i32 {
        a + b
    }

    /// Multiplies two numbers together.
    ///
    /// See also [Self::add].
    #[action]
    fn multiply(a: i32, b: i32) -> i32 {
        a * b
    }
}
