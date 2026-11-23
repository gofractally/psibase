#[crate::service(name = "cpu-limit", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
mod service {
    #[action]
    fn setCpuLimit(limit_ns: Option<u64>) {
        unimplemented!()
    }

    #[action]
    fn getCpuTime() -> psio::time::Duration<psio::time::Nanos> {
        unimplemented!()
    }
}

#[test]
fn verify_schema() {
    crate::assert_schema_matches_package::<Wrapper>();
}
