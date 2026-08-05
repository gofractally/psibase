//! Example service for the out-of-tree SDK template (psibase 0.23 train).
//!
//! Uses a simple action surface (no `service_tables`) so `cargo-psibase package`
//! schema generation works with cargo-psibase 0.23. Monorepo `basic-01` keeps
//! the full tables example for the 0.24+ train.

#[psibase::service(name = "{{project-name}}")]
mod service {
    #[action]
    fn init() {}

    #[action]
    #[allow(non_snake_case)]
    fn setExampleThing(thing: String) {
        // `Wrapper` comes from the `#[psibase::service]` macro expansion.
        Wrapper::emit().history().updated(String::new(), thing);
    }

    #[action]
    #[allow(non_snake_case)]
    fn getExampleThing() -> String {
        // Placeholder until the SDK pin includes cargo-psibase/polyfill support
        // for table schema extraction (`getSequential`).
        String::from("default thing")
    }

    #[event(history)]
    pub fn updated(old_thing: String, new_thing: String) {}
}

#[cfg(test)]
mod tests {
    use crate::Wrapper;

    #[psibase::test_case(packages("{{project-name | upper_camel_case}}"))]
    fn test_get_thing(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init();
        let got = Wrapper::push(&chain).getExampleThing().get()?;
        assert_eq!(got, "default thing");
        Ok(())
    }
}
