// TODO: service flags
#[crate::service(name = "setcode", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
mod service {
    use crate::{AccountNumber, Checksum256, Hex};

    #[action]
    fn init() {}

    #[action]
    fn setCode(service: AccountNumber, vmType: u8, vmVersion: u8, code: Hex<Vec<u8>>) {
        unimplemented!()
    }

    #[action]
    fn stageCode(service: AccountNumber, id: u64, vmType: u8, vmVersion: u8, code: Hex<Vec<u8>>) {
        unimplemented!();
    }

    #[action]
    fn unstageCode(service: AccountNumber, id: u64) {
        unimplemented!();
    }

    #[action]
    fn setCodeStaged(
        from: AccountNumber,
        id: u64,
        vmType: u8,
        vmVersion: u8,
        codeHash: Checksum256,
    ) {
        unimplemented!();
    }

    #[action]
    fn setFlags(service: crate::AccountNumber, flags: u64) {
        unimplemented!()
    }

    #[action]
    fn verifySeq() -> u64 {
        unimplemented!()
    }
}

#[test]
fn verify_schema() {
    crate::assert_schema_matches_package::<Wrapper>();
}
