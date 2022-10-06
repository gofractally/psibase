/// This service manages the active producers.
#[crate::service(name = "producer-sys", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
mod service {
    #[action]
    fn setProducers(prods: Vec<crate::ProducerConfigRow>) {
        unimplemented!();
    }
}
