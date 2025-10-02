pub const CREDENTIAL_SENDER: psibase::AccountNumber = psibase::account!("cred-sys");

#[psibase::service_tables]
pub mod tables {
    use psibase::fracpack::{Pack, Unpack};
    use psibase::{AccountNumber, ToSchema};
    use psibase::{Table, TimePointSec};
    use serde::{Deserialize, Serialize};

    #[table(name = "InitTable", index = 0)]
    #[derive(Serialize, Deserialize, ToSchema, Pack, Unpack, Debug)]
    pub struct InitRow {}
    impl InitRow {
        #[primary_key]
        fn pk(&self) {}
    }

    #[table(name = "CredentialIdTable", index = 1)]
    #[derive(Default, Pack, Unpack, ToSchema, Serialize, Deserialize, Debug)]
    pub struct CredentialId {
        pub id: u32,
    }

    impl CredentialId {
        #[primary_key]
        fn pk(&self) {
            ()
        }

        pub fn next_id() -> u32 {
            let table = CredentialIdTable::new();
            let id = table.get_index_pk().get(&()).unwrap_or_default().id;

            table.put(&CredentialId { id: id + 1 }).unwrap();

            id
        }
    }

    #[table(name = "CredentialTable", index = 2)]
    #[derive(Pack, Unpack, ToSchema, Serialize, Deserialize, Debug)]
    pub struct Credential {
        pub id: u32,
        pub issuer: AccountNumber,
        pub pubkey: Vec<u8>,
        pub issuance_date: TimePointSec,
        pub expiry_date: Option<TimePointSec>,
    }

    impl Credential {
        #[primary_key]
        fn pk(&self) -> u32 {
            self.id
        }

        #[secondary_key(1)]
        fn by_pubkey(&self) -> Vec<u8> {
            self.pubkey.clone()
        }

        #[secondary_key(2)]
        fn by_expiry_date(&self) -> (Option<TimePointSec>, u32) {
            (self.expiry_date, self.id)
        }
    }
}

#[psibase::service(name = "credentials", tables = "tables")]
pub mod service {
    use crate::tables::{Credential, CredentialId, CredentialTable, InitRow, InitTable};
    use crate::CREDENTIAL_SENDER;
    use psibase::services::auth_sig::SubjectPublicKeyInfo;
    use psibase::services::{accounts, transact, transact::ServiceMethod};
    use psibase::*;

    #[action]
    fn init() {
        InitTable::new().put(&InitRow {}).unwrap();
        accounts::Wrapper::call().newAccount(
            AccountNumber::from(CREDENTIAL_SENDER),
            Wrapper::SERVICE,
            false,
        );
    }

    #[pre_action(exclude(init))]
    fn check_init() {
        let table = InitTable::read();
        check(
            table.get_index_pk().get(&()).is_some(),
            "service not inited",
        );
    }

    #[action]
    #[allow(non_snake_case)]
    fn canAuthUserSys(user: AccountNumber) {
        check(
            user == CREDENTIAL_SENDER,
            &format!(
                "only {} can use credentials as an auth service",
                CREDENTIAL_SENDER
            ),
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
        _requester: AccountNumber,
        sender: AccountNumber,
        action: ServiceMethod,
        _allowedActions: Vec<ServiceMethod>,
        claims: Vec<Claim>,
    ) {
        use psibase::services::transact::auth_interface::*;

        let auth_type = flags & REQUEST_MASK;

        match auth_type {
            RUN_AS_REQUESTER_REQ | RUN_AS_MATCHED_REQ => return,
            RUN_AS_MATCHED_EXPANDED_REQ => check(false, "runAs: caller attempted to expand powers"),
            RUN_AS_OTHER_REQ => check(false, "runAs: caller is not authorized"),
            t if t != TOP_ACTION_REQ => check(false, "unsupported auth type"),
            _ => {}
        }

        check(
            sender == CREDENTIAL_SENDER,
            &format!("sender must be {}", CREDENTIAL_SENDER),
        );

        check(claims.len() == 1, "Must be exactly one claim");
        let claim = &claims[0];

        check(
            claim.service == psibase::services::verify_sig::SERVICE,
            "Claim must use verify-sig",
        );

        let credential = CredentialTable::read()
            .get_index_by_pubkey()
            .get(&claim.rawData);
        check(credential.is_some(), "Claim uses an invalid credential");
        let credential = credential.unwrap();

        check(
            action.service == credential.issuer,
            "Can only call actions on the credential issuer service",
        );

        check(
            credential.expiry_date.is_none() || credential.expiry_date.unwrap() > now(),
            "Credential expired",
        );
    }

    /// Creates a credential
    ///
    /// Parameters:
    /// - `pubkey`: The credential public key
    /// - `expires`: The number of seconds until the credential expires
    ///
    /// This action is meant to be called inline by another service.
    /// The caller service is the credential issuer.
    ///
    /// A transaction sent from the CREDENTIAL_SENDER account must include a proof for a claim
    /// that matches the specified public key.
    #[action]
    fn create(pubkey: SubjectPublicKeyInfo, expires: Option<u32>) -> u32 {
        let table = CredentialTable::new();

        let existing = table.get_index_by_pubkey().get(&pubkey.0);
        check_none(existing, "Credential already exists");
        let id = CredentialId::next_id();
        let now = transact::Wrapper::call().currentBlock().time.seconds();
        table
            .put(&Credential {
                id,
                issuer: get_sender(),
                pubkey: pubkey.0.clone(),
                issuance_date: now,
                expiry_date: expires.map(|e| now + psibase::Seconds::new(e as i64)),
            })
            .unwrap();

        id
    }

    /// Looks up the credential used to sign the active transaction, and consumes it.
    /// Can only be called by the credential's issuer.
    #[action]
    fn consume_active() -> u32 {
        let id = get_active().expect("No active credential");
        consume(id);
        id
    }

    /// Gets the `pubkey` of the specified credential
    #[action]
    fn get_pubkey(id: u32) -> SubjectPublicKeyInfo {
        CredentialTable::read()
            .get_index_pk()
            .get(&id)
            .expect("Credential DNE")
            .pubkey
            .into()
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
        let claims = transact::Wrapper::call().getTransaction().claims;
        let table = CredentialTable::read().get_index_by_pubkey();

        let mut active_id = None;
        let now = transact::Wrapper::call().currentBlock().time.seconds();
        for claim in claims {
            if let Some(credential) = table.get(&claim.rawData) {
                check(
                    active_id.is_none(),
                    "Only one active credential is supported",
                );
                check(
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
        let table = CredentialTable::new();
        let credential = table.get_index_pk().get(&id).expect("Credential DNE");
        check(credential.issuer == get_sender(), "Unauthorized");
        table.remove(&credential);
    }
}
