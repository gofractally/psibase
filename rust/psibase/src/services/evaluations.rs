#[crate::service(name = "eval-hooks", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
pub mod Hooks {
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
    fn evalGroupFin(evaluation_id: u32, group_number: u32, result: Vec<u8>) {
        unimplemented!()
    }
}
