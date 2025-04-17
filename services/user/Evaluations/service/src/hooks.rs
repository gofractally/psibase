#[psibase::service(name = "eval-hooks", dispatch = false, pub_constant = false)]
#[allow(non_snake_case, unused_variables)]
pub mod eval_hooks {
    use psibase::AccountNumber;

    #[action]
    fn evalRegister(evaluation_id: u32, account: AccountNumber) {
        unimplemented!()
    }

    #[action]
    fn evalPropose(evaluation_id: u32, group_nr: u32, proposer: AccountNumber) {
        unimplemented!()
    }

    #[action]
    fn evalAttest(evaluation_id: u32, group_nr: u32, attester: AccountNumber) {
        unimplemented!()
    }

    #[action]
    fn evalGroupFin(evaluation_id: u32, group_nr: u32, result: Vec<u8>) {
        unimplemented!()
    }
}
