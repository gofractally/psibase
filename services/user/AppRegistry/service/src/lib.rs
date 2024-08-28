#[psibase::service]
#[allow(non_snake_case)]
mod service {
    #[action]
    fn foo(value: i32) -> i32 {
        value
    }
}

#[psibase::test_case(packages("TestPackage"))]
fn test_foo(chain: psibase::Chain) -> Result<(), psibase::Error> {
    assert_eq!(Wrapper::push(&chain).foo(42).get()?, 42);
    Ok(())
}
