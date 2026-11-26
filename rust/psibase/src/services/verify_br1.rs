/// Verifies signatures made with secp256r1 (P-256) keys, with BearSSL: the
/// second verifier for the curve, which an account may choose in auth-sig.
/// See `psibase::allowed_verifiers`.
#[crate::service(name = "verify-br1", dispatch = false, psibase_mod = "crate")]
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
