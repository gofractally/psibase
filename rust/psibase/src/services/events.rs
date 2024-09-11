#[crate::service(name = "events", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
mod service {
    use crate::Schema;

    // #[action]
    fn setSchema(schema: Schema) {
        unimplemented!()
    }

    #[action]
    fn addIndex(db_id: u32, service: crate::AccountNumber, event: crate::MethodNumber, column: u8) {
        unimplemented!()
    }
}
