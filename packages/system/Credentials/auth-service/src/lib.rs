#[psibase::service(name = "auth-cred")]
pub mod service {
    use credentials::tables::CredentialTable;
    use psibase::services::transact::ServiceMethod;
    use psibase::*;

    #[action]
    #[allow(non_snake_case)]
    fn checkAuthSys(
        flags: u32,
        _requester: AccountNumber,
        sender: AccountNumber,
        action: ServiceMethod,
        _allowedActions: Vec<ServiceMethod>,
        claims: Vec<Claim>,
    ) {
        use psibase::services::transact::auth_interface::*;

        let auth_type = flags & REQUEST_MASK;

        if auth_type == RUN_AS_REQUESTER_REQ {
            return; // Request is valid
        } else if auth_type == RUN_AS_MATCHED_REQ {
            return; // Request is valid
        } else if auth_type == RUN_AS_MATCHED_EXPANDED_REQ {
            check(false, "runAs: caller attempted to expand powers");
        } else if auth_type == RUN_AS_OTHER_REQ {
            check(false, "runAs: caller is not authorized");
        } else if auth_type != TOP_ACTION_REQ {
            check(false, "unsupported auth type");
        }

        check(
            sender.to_string() == credentials::CREDENTIAL_SENDER,
            "sender must be cred-sys",
        );

        check(claims.len() == 1, "Must be exactly one claim");
        let claim = &claims[0];

        check(
            claim.service == AccountNumber::from("verify-sig"),
            "Claim must be for VerifySig",
        );

        let credential = CredentialTable::with_service(credentials::SERVICE)
            .get_index_by_pubkey()
            .get(&claim.rawData);
        check(credential.is_some(), "Claim must be for a valid credential");
        let credential = credential.unwrap();

        check(
            action.service == credential.owner,
            "Can only call actions on the service that owns the credential",
        );
    }

    #[action]
    #[allow(non_snake_case)]
    fn canAuthUserSys(user: AccountNumber) {
        check(
            user.to_string() == credentials::CREDENTIAL_SENDER,
            &format!(
                "only {} account can use credentials",
                credentials::CREDENTIAL_SENDER
            ),
        );
    }
}
