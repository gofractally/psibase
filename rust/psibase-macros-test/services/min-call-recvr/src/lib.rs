#[psibase::service(name = "mincallrecvr")]
mod service {
    #[action]
    // got an error because serde dep wasn't present?
    fn add2(a: i32, b: i32) -> i32 {
        a + b
    }
}
