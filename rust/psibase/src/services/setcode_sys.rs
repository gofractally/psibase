// TODO: service flags
#[crate::service(name = "setcode-sys", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
mod service {
    #[action]
    fn setCode(service: crate::AccountNumber, vmType: u8, vmVersion: u8, code: Vec<u8>) {
        unimplemented!()
    }

    #[action]
    fn setFlags(service: crate::AccountNumber, flags: u64) {
        unimplemented!()
    }
}
