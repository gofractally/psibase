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
    fn evalGroupFin(evaluation_id: u32, group_number: u32, result: Vec<u8>) {
        unimplemented!()
    }

    #[action]
    fn create(
        registration: u32,
        deliberation: u32,
        submission: u32,
        finish_by: u32,
        allowed_group_sizes: Vec<u8>,
        num_options: u8,
        use_hooks: bool,
    ) {
        unimplemented!()
    }

    #[action]
    fn close(id: u32){
        unimplemented!()
    }
    
}
