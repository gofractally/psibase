#[psibase::service(name = "test-panic")]
mod service {
    #[action]
    fn panic(msg: String) {
        panic!("{msg}");
    }
}

#[psibase::test_case(packages("test_panic"))]
fn test1(chain: psibase::Chain) -> Result<(), psibase::Error> {
    use psibase::*;
    Wrapper::push(&chain)
        .panic("asdf".to_string())
        .match_error("asdf")?;
    Ok(())
}
