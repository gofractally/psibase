#[crate::service(name = "evaluation", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
mod service {
    use crate::AccountNumber;

    #[action]
    fn evalRegister(evaluation_id: u32, account: AccountNumber) {
        unimplemented!()
    }

    #[action]
    fn evalUnregister(evaluation_id: u32, account: AccountNumber) {
        unimplemented!()
    }

    #[action]
    fn evalGroupFin(owner: AccountNumber, evaluation_id: u32, group_number: u32, users: Vec<AccountNumber>, result: Vec<u8>) {
        unimplemented!()
    }

    
    #[action]
    fn evalFin(owner: AccountNumber, evaluation_id: u32) {
        unimplemented!()
    }
}
