#[psibase::service(name = "eval-hooks", dispatch = false, pub_constant = false)]
#[allow(non_snake_case, unused_variables)]
pub mod eval_hooks {
    use psibase::AccountNumber;

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

    #[action]
    fn evalFin(evaluation_id: u32) {
        unimplemented!()
    }
}
