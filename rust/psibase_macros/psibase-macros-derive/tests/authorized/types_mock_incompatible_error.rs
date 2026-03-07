pub mod trust {
    #[allow(dead_code)]
    pub enum TrustLevel {
        None,
        Low,
        Medium,
        High,
        Max,
    }

    pub trait TrustConfig {
        fn assert_authorized(level: TrustLevel, fn_name: &str) -> Result<(), i32>;
        fn assert_authorized_with_whitelist(
            level: TrustLevel,
            fn_name: &str,
            whitelist: &[&str],
        ) -> Result<(), i32>;
    }
}
