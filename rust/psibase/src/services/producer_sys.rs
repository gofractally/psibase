/// This service manages the active producers.
#[crate::service(dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables, dead_code)]
pub mod service {
    pub const SERVICE: crate::AccountNumber =
        crate::AccountNumber::new(crate::account_raw!("producer-sys"));

    #[action]
    pub fn setProducers(prods: Vec<crate::ProducerConfigRow>) {
        unimplemented!();
    }
}
