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

    #[action]
    #[allow(non_snake_case)]
    fn serveSys(request: HttpRequest) -> Option<HttpReply> {
        serve_simple_ui::<Wrapper>(&request)
    }
}

#[psibase::test_case(packages("test_contract"))]
fn test1(chain: psibase::Chain) -> Result<(), psibase::Error> {
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
