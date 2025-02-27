// TODO: service flags
#[crate::service(name = "setcode", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
mod service {
    use crate::{AccountNumber, Checksum256, Hex};

    #[action]
    fn setCode(service: AccountNumber, vmType: u8, vmVersion: u8, code: Hex<Vec<u8>>) {
        unimplemented!()
    }

    #[action]
    fn stageCode(
        service: AccountNumber,
        id: Checksum256,
        vmType: u8,
        vmVersion: u8,
        code: Hex<Vec<u8>>,
    ) {
        unimplemented!();
    }

    #[action]
    fn unstageCode(service: AccountNumber, id: Checksum256) {
        unimplemented!();
    }

    #[action]
    fn setCodeStaged(
        from: AccountNumber,
        id: Checksum256,
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
}
