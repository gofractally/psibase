#[crate::service(name = "events", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
mod service {
    use crate::{AccountNumber, DbId, MethodNumber, Schema};

    #[action]
    fn setSchema(schema: Schema) {
        unimplemented!()
    }

    #[action]
    fn addIndex(db_id: DbId, service: AccountNumber, event: MethodNumber, column: u8) {
        unimplemented!()
    }
}
