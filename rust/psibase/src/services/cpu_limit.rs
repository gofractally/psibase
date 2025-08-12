#[crate::service(name = "cpu-limit", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
mod service {
    use crate::AccountNumber;

    #[action]
    fn setCpuLimit(name: AccountNumber) {
        unimplemented!()
    }

    #[action]
    fn getCpuTime() -> i64 {
        unimplemented!()
    }
}

#[test]
fn verify_schema() {
    crate::assert_schema_matches_package::<Wrapper>();
}
