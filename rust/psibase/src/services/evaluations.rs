#[crate::service(name = "evaluation", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
mod service {

    use crate::AccountNumber;

    #[action]
    fn register(evaluation_id: u32, registrant: AccountNumber) {
        unimplemented!()
    }
}
