mod tables;

pub const CRED_SYS: psibase::AccountNumber = psibase::account!("cred-sys");

#[psibase::service(name = "credential", tables = "tables::tables")]
pub mod service {
    use crate::tables::tables::*;
    use crate::CRED_SYS;
    use psibase::services::{
        tokens::{Quantity, Wrapper as Tokens},
        transact::{ServiceMethod, Wrapper as Transact},
        virtual_server::Wrapper as VirtualServer,
    };
    use psibase::*;

    const VSERVER: AccountNumber = VirtualServer::SERVICE;

    #[action]
    fn init() {
        InitRow::init();
    }

    #[pre_action(exclude(init))]
    fn check_init() {
        let table = InitTable::read();
        assert!(
            table.get_index_pk().get(&()).is_some(),
            "service not inited",
        );
    }

    #[action]
    #[allow(non_snake_case)]
    fn canAuthUserSys(user: AccountNumber) {
        assert_eq!(
            user, CRED_SYS,
            "only {CRED_SYS} can use credentials as an auth service",
        );
    }

    fn now() -> TimePointSec {
        let native = KvHandle::new(psibase::DbId::Native, &[], KvMode::Read);
        let status = kv_get::<psibase::StatusRow, _>(&native, &psibase::status_key())
            .unwrap()
            .unwrap();

        status.current.time.seconds()
    }

    #[action]
    #[allow(non_snake_case)]
    fn checkAuthSys(
        flags: u32,
        requester: AccountNumber,
        sender: AccountNumber,
        action: ServiceMethod,
        _allowedActions: Vec<ServiceMethod>,
        claims: Vec<Claim>,
    ) -> bool {
        use psibase::services::transact::auth_interface::*;

        let auth_type = flags & REQUEST_MASK;
        match auth_type {
            RUN_AS_REQUESTER_REQ | RUN_AS_MATCHED_REQ => return true,
            RUN_AS_MATCHED_EXPANDED_REQ => panic!("runAs: caller attempted to expand powers"),
            RUN_AS_OTHER_REQ => {
                if requester == Wrapper::SERVICE {
                    // This allows credentials service to call actions on behalf of any credential
                    return true;
                } else {
                    panic!("runAs: caller is not authorized")
                }
            }
            t if t != TOP_ACTION_REQ => panic!("unsupported auth type"),
            _ => {}
        }

        assert_eq!(sender, CRED_SYS, "sender must be {}", CRED_SYS);

        assert_eq!(claims.len(), 1, "Must be exactly one claim");
        let claim = &claims[0];

        let credential = CredentialTable::read()
            .get_index_by_pkh()
            .get(&psibase::sha256(&claim.rawData))
            .expect("Claim uses an invalid credential");

        // FIRST_AUTH_FLAG is set when this check is running for the top-level action and
        // we are NOT executing speculatively.
        if (flags & FIRST_AUTH_FLAG) != 0 && VirtualServer::call().is_billing_enabled() {
            VirtualServer::call_as(CRED_SYS).bill_to_sub(credential.id.to_string());
        }

        assert_eq!(
            claim.service,
            psibase::services::verify_sig::SERVICE,
            "Claim must use verify-sig",
        );

        assert_eq!(
            action.service, credential.issuer,
            "Can only call actions on the credential issuer service",
        );
        assert!(
            credential.allowed_actions.contains(&action.method),
            "Action {} not allowed using this credential",
            action.method
        );

        assert!(
            credential.expiry_date.is_none() || credential.expiry_date.unwrap() > now(),
            "Credential expired",
        );
        true
    }

    #[action]
    #[allow(non_snake_case)]
    fn getDlgsSys(_sender: AccountNumber) -> Vec<AccountNumber> {
        Vec::new()
    }

    #[action]
    #[allow(non_snake_case)]
    fn isAuthSys(_sender: AccountNumber, _authorizers: Vec<AccountNumber>) -> bool {
        abort_message("isAuthSys not supported");
    }

    #[action]
    #[allow(non_snake_case)]
    fn isRejectSys(_sender: AccountNumber, _rejecters: Vec<AccountNumber>) -> bool {
        abort_message("isRejectSys not supported");
    }

    /// Issues a credential
    ///
    /// Parameters:
    /// - `pubkey_fingerprint`: The fingerprint of the credential public key
    /// - `expires`: The number of seconds until the credential expires
    /// - `allowed_actions`: The actions that the credential is allowed to call on the issuer service
    ///
    /// This action is meant to be called inline by another service.
    /// The caller service is the credential issuer.
    ///
    /// A transaction sent from the CREDENTIAL_SENDER account must include a proof for a claim
    /// that matches the specified public key.
    #[action]
    fn issue(
        pubkey_fingerprint: Checksum256,
        expires: Option<u32>,
        allowed_actions: Vec<MethodNumber>,
    ) -> u32 {
        Credential::add(pubkey_fingerprint, expires, allowed_actions)
    }

    /// Notifies the credentials service that tokens have been credited to a credential
    ///
    /// This notification must be called after crediting the credential's service, or else
    /// the credited tokens will not be aplied to a particular credential.
    #[action]
    fn resource(id: u32, amount: Quantity) {
        let credential = CredentialTable::read()
            .get_index_pk()
            .get(&id)
            .expect("Credential not found");

        assert_eq!(
            credential.issuer,
            get_sender(),
            "Only the issuer can credit this credential",
        );
        let sys = Tokens::call()
            .getSysToken()
            .expect("System token not found")
            .id;

        Tokens::call().debit(sys, get_sender(), amount, "".into());
        Tokens::call().credit(sys, CRED_SYS, amount, "".into());
        Tokens::call_as(CRED_SYS).debit(sys, SERVICE, amount, "".into());
        Tokens::call_as(CRED_SYS).credit(sys, VSERVER, amount, "".into());
        VirtualServer::call_as(CRED_SYS).buy_res_sub(amount, id.to_string());
    }

    /// Gets the fingerprint of the specified credential pubkey
    #[allow(non_snake_case)]
    #[action]
    fn getFingerprint(id: u32) -> Checksum256 {
        CredentialTable::read()
            .get_index_pk()
            .get(&id)
            .expect("Credential DNE")
            .pubkey_fingerprint
    }

    /// Gets the `expiry_date` of the specified credential
    #[action]
    fn get_expiry_date(id: u32) -> Option<TimePointSec> {
        CredentialTable::read()
            .get_index_pk()
            .get(&id)
            .expect("Credential DNE")
            .expiry_date
    }

    /// Gets the `id` of the active credential
    #[action]
    fn get_active() -> Option<u32> {
        let claims = Transact::call().getTransaction().claims;
        let table = CredentialTable::read().get_index_by_pkh();

        let mut active_id = None;
        let now = Transact::call().currentBlock().time.seconds();
        for claim in claims {
            if let Some(credential) = table.get(&psibase::sha256(&claim.rawData)) {
                assert!(
                    active_id.is_none(),
                    "Only one active credential is supported",
                );
                assert!(
                    credential.expiry_date.is_none() || credential.expiry_date.unwrap() > now,
                    "Credential expired",
                );
                active_id = Some(credential.id);
            }
        }

        active_id
    }

    /// Deletes the specified credential.
    /// Can only be called by the credential's issuer.
    #[action]
    fn consume(id: u32) {
        let table = CredentialTable::read_write();

        let credential = table.get_index_pk().get(&id).expect("Credential DNE");
        assert_eq!(credential.issuer, get_sender(), "Unauthorized");
        table.remove(&credential);

        // Avoid orphaned resources
        VirtualServer::call_as(CRED_SYS).del_res_sub(id.to_string());
    }
}
