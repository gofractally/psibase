#[psibase::service]
mod service {
    #[action]
    fn add(a: i32, b: i32) -> i32 {
        a + b
    }

    #[action]
    fn multiply(a: i32, b: i32) -> i32 {
        a * b
    }
}