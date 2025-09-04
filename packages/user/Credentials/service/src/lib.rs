pub const CREDENTIAL_SENDER: &str = "cred-sys";

#[psibase::service_tables]
pub mod tables {
    use psibase::fracpack::{Pack, Unpack};
    use psibase::Table;
    use psibase::{AccountNumber, ToSchema};
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
        pub owner: AccountNumber,
        pub pubkey: Vec<u8>,
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
    }
}

#[psibase::service(name = "credentials", tables = "tables")]
pub mod service {
    use crate::tables::{Credential, CredentialId, CredentialTable, InitTable};
    use crate::CREDENTIAL_SENDER;
    use psibase::services::auth_sig::SubjectPublicKeyInfo;
    use psibase::services::{auth_delegate, transact};
    use psibase::*;

    #[action]
    fn init() {
        auth_delegate::Wrapper::call().newAccount(
            AccountNumber::from(CREDENTIAL_SENDER),
            AccountNumber::from("root"),
        );
    }

    #[pre_action(exclude(init))]
    fn check_init() {
        let table = InitTable::new();
        check(
            table.get_index_pk().get(&()).is_some(),
            "service not inited",
        );
    }

    /// Creates a credential with the given public key
    ///
    /// This action is meant to be called inline by another service.
    /// The owner service is the service that calls this action.
    ///
    /// The corresponding private key can be used to authorize the "cred-sys" account to call
    ///   transactions containing actions on the owner service.
    #[action]
    fn create(pubkey: SubjectPublicKeyInfo) -> u32 {
        let table = CredentialTable::new();

        let existing = table.get_index_by_pubkey().get(&pubkey.0);
        check_none(existing, "Credential already exists");
        let id = CredentialId::next_id();
        table
            .put(&Credential {
                id,
                owner: get_sender(),
                pubkey: pubkey.0.clone(),
            })
            .unwrap();

        id
    }

    /// Looks up the credential used to sign the active transaction, and consumes (deletes) it.
    /// Can only be called by the credential's owner service.
    #[action]
    fn consume_active() -> u32 {
        let claims = transact::Wrapper::call().getTransaction().claims;
        check(claims.len() == 1, "Must be exactly one claim");
        let claim = &claims[0];

        let active_key = claim.rawData.clone();

        let table = CredentialTable::new();
        let credential = table.get_index_by_pubkey().get(&active_key);
        check(credential.is_some(), "Credential does not exist");

        let credential = credential.unwrap();
        check(
            credential.owner == get_sender(),
            "Only owner can consume credential",
        );
        let id = credential.id;
        table.remove(&credential);
        id
    }
}
