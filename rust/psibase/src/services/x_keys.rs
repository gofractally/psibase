#[crate::service(name = "x-keys", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
mod service {
    use crate::services::auth_sig::SubjectPublicKeyInfo;
    use crate::{Action, SignedTransaction};

    /// Creates a new key pair and returns the public key
    ///
    /// The key can only be used by the caller
    #[action]
    fn newKey() -> SubjectPublicKeyInfo {
        unimplemented!()
    }

    /// Deletes a private key
    ///
    /// The key must have been created by the caller
    #[action]
    fn deleteKey(key: SubjectPublicKeyInfo) {
        unimplemented!()
    }

    /// Signs a transaction
    ///
    /// All the required keys myst have been created by the caller
    #[action]
    fn signTx(actions: Vec<Action>) -> SignedTransaction {
        unimplemented!()
    }
}

#[test]
fn verify_schema() {
    // C++ `SignedTransaction::transaction` is a nested `Transaction`; Rust holds
    // its packed bytes. Both pack as the same length-prefixed bytes.
    crate::assert_schema_matches_package_allowing::<Wrapper>(
        fracpack::SchemaDifference::ADD_ALTERNATIVE,
    );
}
