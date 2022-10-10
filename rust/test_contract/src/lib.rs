//! This is the example from the book, but loaded with
//! doc strings to test the [psibase::service] macro's
//! handling of them.

/// This service adds and multiplies `i32` numbers.
///
/// This is where a detailed description would go.
#[psibase::service()]
mod service {
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
}

#[psibase::test_case(services("test_contract"))]
fn test1(chain: psibase::Chain) -> Result<(), psibase::Error> {
    assert_eq!(Wrapper::push(&chain).add(3, 4).get()?, 7);
    assert_eq!(Wrapper::push(&chain).multiply(3, 4).get()?, 12);

    println!("{}", Wrapper::push(&chain).add(9, 8).trace);

    Ok(())
}
