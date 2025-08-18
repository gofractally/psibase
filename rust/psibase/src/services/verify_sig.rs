#[crate::service(name = "verify-sig", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
mod service {
    use crate::{Checksum256, Claim, Hex};

    const SERVICE_FLAGS: u64 = crate::CodeRow::IS_VERIFY;

    #[action]
    fn verifySys(transactionHash: Checksum256, claim: Claim, proof: Hex<Vec<u8>>) {
        unimplemented!()
    }
}

#[test]
fn verify_schema() {
    crate::assert_schema_matches_package::<Wrapper>();
}
