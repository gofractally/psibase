#[crate::service(name = "eval-hooks", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
pub mod Hooks {
    use crate::AccountNumber;

    #[action]
    fn create(
        registration: u32,
        deliberation: u32,
        submission: u32,
        finish_by: u32,
        allowed_group_sizes: Vec<u8>,
        num_options: u8,
        use_hooks: bool,
    ) -> u32 {
        unimplemented!()
    }

    #[action]
    fn start(owner: AccountNumber, evaluation_id: u32) {
        unimplemented!()
    }

    #[action]
    fn setKey(key: Vec<u8>) {
        unimplemented!()
    }

    #[action]
    fn groupKey(owner: AccountNumber, evaluation_id: u32, keys: Vec<Vec<u8>>, hash: String) {
        unimplemented!()
    }

    #[action]
    fn close(owner: AccountNumber, evaluation_id: u32) {
        unimplemented!()
    }

    #[action]
    fn delete(evaluation_id: u32, force: bool) {
        unimplemented!()
    }

    #[action]
    fn propose(owner: AccountNumber, evaluation_id: u32, proposal: Vec<u8>) {
        unimplemented!()
    }

    #[action]
    fn attest(owner: AccountNumber, evaluation_id: u32, attestation: Vec<u8>) {
        unimplemented!()
    }

    #[action]
    fn evalRegister(evaluation_id: u32, account: AccountNumber) {
        unimplemented!()
    }

    #[action]
    fn evalUnregister(evaluation_id: u32, account: AccountNumber) {
        unimplemented!()
    }

    #[action]
    fn evalGroupFin(
        owner: AccountNumber,
        evaluation_id: u32,
        group_number: u32,
        users: Vec<AccountNumber>,
        result: Vec<u8>,
    ) {
        unimplemented!()
    }

    #[action]
    fn evalFin(owner: AccountNumber, evaluation_id: u32) {
        unimplemented!()
    }

    #[action]
    fn register(owner: AccountNumber, evaluation_id: u32, registrant: AccountNumber) {
        unimplemented!()
    }

    #[action]
    fn unregister(owner: AccountNumber, evaluation_id: u32, registrant: AccountNumber) {
        unimplemented!()
    }
}