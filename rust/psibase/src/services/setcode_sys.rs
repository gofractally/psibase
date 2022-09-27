// TODO: service flags
#[crate::service(dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables, dead_code)]
pub mod service {
    pub const SERVICE: crate::AccountNumber =
        crate::AccountNumber::new(crate::account_raw!("setcode-sys"));

    #[action]
    pub fn setCode(service: crate::AccountNumber, vmType: u8, vmVersion: u8, code: Vec<u8>) {
        unimplemented!()
    }

    #[action]
    pub fn setFlags(service: crate::AccountNumber, flags: u64) {
        unimplemented!()
    }
}
