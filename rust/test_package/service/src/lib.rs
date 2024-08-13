#[psibase::service]
#[allow(non_snake_case)]
mod service {
    #[action]
    fn foo(value: i32) -> i32 {
        value
    }
}
