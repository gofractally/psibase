#[crate::service(name = "events", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
mod service {

    #[action]
    fn setSchema(schema: crate::Schema) {
        unimplemented!()
    }

    #[action]
    fn addIndex(
        db_id: crate::DbId,
        service: crate::AccountNumber,
        event: crate::MethodNumber,
        column: u8,
    ) {
        unimplemented!()
    }
}
