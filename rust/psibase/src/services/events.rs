#[crate::service(name = "events", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
mod service {
    use crate::{AccountNumber, DbId, MethodNumber};

    pub type EventDb = DbId;

    #[action]
    fn addIndex(db_id: DbId, service: AccountNumber, event: MethodNumber, column: u8) {
        unimplemented!()
    }

    /// Writes an event to the event log
    #[action]
    fn event(db: EventDb, type_: MethodNumber, rawData: Vec<u8>) -> u64 {
        unimplemented!()
    }

    #[action]
    fn sync() {
        unimplemented!()
    }
}

#[test]
fn verify_schema() {
    crate::assert_schema_matches_package::<Wrapper>();
}
