#[psibase::service(name = "minrecvr")]
mod service {
    #[action]
    fn add2(a: i32, b: i32) -> i32 {
        a + b
    }
}
