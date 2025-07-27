#[crate::service(name = "registry", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
mod service {
    use crate::AccountNumber;

    #[action]
    fn setMetadata(
        name: String,
        short_description: String,
        long_description: String,
        tags: Vec<String>,
    ) {
        unimplemented!()
    }

    #[action]
    fn publish(account_id: AccountNumber) {
        unimplemented!()
    }

    #[action]
    fn unpublish(account_id: AccountNumber) {
        unimplemented!()
    }
}
