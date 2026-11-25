/// Verifies signatures made with secp256r1 (P-256) keys. Use
/// `psibase::verifier_for` to find the verifier for a key.
#[crate::service(name = "verify-r1", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
mod service {
    use crate::{Checksum256, Claim};

    const SERVICE_FLAGS: u64 = crate::CodeRow::IS_VERIFY;

    #[action]
    fn verifySys(transactionHash: Checksum256, claim: Claim, proof: Vec<u8>) {
        unimplemented!()
    }
}

#[test]
fn verify_schema() {
    crate::assert_schema_matches_package::<Wrapper>();
}
