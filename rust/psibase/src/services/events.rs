#[crate::service(name = "events", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
mod service {
    use crate::{AccountNumber, DbId, MethodNumber};

    #[action]
    fn addIndex(db_id: DbId, service: AccountNumber, event: MethodNumber, column: u8) {
        unimplemented!()
    }
}

#[test]
fn verify_schema() {
    crate::assert_schema_matches_package::<Wrapper>();
}
