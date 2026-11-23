use psibase::*;
use serde::{Deserialize, Serialize};
#[psibase::service_tables]
pub mod tables {
    use super::*;
    #[table(name = "SigningConfigTable", index = 0)]
    #[derive(Clone, Debug, Pack, Unpack, ToSchema, Serialize, Deserialize, psio::PsszPack, psio::PsszUnpack, psio::PsszView, psio::ToPsszSchema, psio::JsonText)]
    pub struct SigningConfig {
        pub deployment: String,
        pub providers: Vec<AccountNumber>,
        pub next_key: u32,
        pub next_request: u64,
    }
    impl SigningConfig {
        #[primary_key]
        fn pk(&self) {}
    }
    #[table(name = "KeyTable", index = 1)]
    #[derive(Clone, Debug, Pack, Unpack, ToSchema, Serialize, Deserialize, psio::PsszPack, psio::PsszUnpack, psio::PsszView, psio::ToPsszSchema, psio::JsonText)]
    pub struct Key {
        #[primary_key]
        pub id: u32,
        pub owner: AccountNumber,
        pub provider: AccountNumber,
        pub public_root: String,
        pub requested_block: u32,
        pub published_block: u32,
    }
    impl Key {
        #[secondary_key(1)]
        fn by_provider(&self) -> (AccountNumber, u32) {
            (self.provider, self.id)
        }
    }
    #[table(name = "HashRequestTable", index = 2)]
    #[derive(Clone, Debug, Pack, Unpack, ToSchema, Serialize, Deserialize, psio::PsszPack, psio::PsszUnpack, psio::PsszView, psio::ToPsszSchema, psio::JsonText)]
    pub struct HashRequest {
        #[primary_key]
        pub id: u64,
        pub key: u32,
        pub provider: AccountNumber,
        pub path: Vec<u32>,
        pub hash: String,
        pub public_key: String,
        pub requested_block: u32,
        pub signature: String,
        pub complete: bool,
    }
    impl HashRequest {
        #[secondary_key(1)]
        fn by_pending(&self) -> (AccountNumber, bool, u64) {
            (self.provider, self.complete, self.id)
        }
    }
    #[table(name = "PendingKeyTable", index = 3)]
    #[derive(Clone, Debug, Pack, Unpack, ToSchema, Serialize, Deserialize, psio::PsszPack, psio::PsszUnpack, psio::PsszView, psio::ToPsszSchema, psio::JsonText)]
    pub struct PendingKey {
        #[primary_key]
        pub id: u32,
        pub provider: AccountNumber,
    }
    impl PendingKey {
        #[secondary_key(1)]
        fn by_provider(&self) -> (AccountNumber, u32) {
            (self.provider, self.id)
        }
    }
}
pub use tables::*;
fn must<T>(r: signing_core::Result<T>) -> T {
    r.unwrap_or_else(|e| abort_message(&e))
}
fn config() -> SigningConfig {
    SigningConfigTable::read()
        .get_index_pk()
        .get(&())
        .expect("Signing service not initialized")
}
#[psibase::service(name = "signhash", tables = "tables")]
#[allow(non_snake_case)]
pub mod service {
    use super::*;
    #[action]
    fn init(deployment: String, providers: Vec<AccountNumber>) {
        assert_eq!(
            get_sender(),
            Wrapper::SERVICE,
            "Signing initialization authority"
        );
        assert!(
            SigningConfigTable::read().get_index_pk().get(&()).is_none(),
            "Signing service already initialized"
        );
        assert!(
            deployment.len() == 64 && deployment.bytes().all(|b| b.is_ascii_hexdigit()),
            "Deployment identity must be 32-byte hex"
        );
        assert!(
            !providers.is_empty() && providers.len() <= 32,
            "Provider limit"
        );
        let mut distinct = providers.clone();
        distinct.sort_by_key(|a| a.value);
        distinct.dedup();
        assert_eq!(
            distinct.len(),
            providers.len(),
            "Duplicate signing provider"
        );
        SigningConfigTable::read_write()
            .put(&SigningConfig {
                deployment,
                providers,
                next_key: 1,
                next_request: 1,
            })
            .unwrap();
    }
    #[action]
    fn newKey(provider: AccountNumber) -> u32 {
        let mut c = config();
        assert!(c.providers.contains(&provider), "Unknown signing provider");
        let id = c.next_key;
        assert!(id < 1 << 31, "Key namespace exhausted");
        c.next_key += 1;
        KeyTable::read_write()
            .put(&Key {
                id,
                owner: get_sender(),
                provider,
                public_root: String::new(),
                requested_block: psibase::services::transact::Wrapper::call()
                    .currentBlock()
                    .blockNum,
                published_block: 0,
            })
            .unwrap();
        PendingKeyTable::read_write()
            .put(&PendingKey { id, provider })
            .unwrap();
        SigningConfigTable::read_write().put(&c).unwrap();
        id
    }
    #[action]
    fn publishKey(key: u32, public_root: String) {
        let mut k = KeyTable::read()
            .get_index_pk()
            .get(&key)
            .expect("Unknown signing key");
        assert_eq!(
            get_sender(),
            k.provider,
            "Key publication requires designated provider"
        );
        assert!(k.public_root.is_empty(), "Public key is immutable");
        let block = psibase::services::transact::Wrapper::call().currentBlock();
        assert!(
            block.commitNum >= k.requested_block,
            "Key request is not final"
        );
        must(signing_core::child_public(&public_root, &[]));
        k.public_root = public_root;
        k.published_block = block.blockNum;
        KeyTable::read_write().put(&k).unwrap();
        if let Some(p) = PendingKeyTable::read().get_index_pk().get(&key) {
            PendingKeyTable::read_write().remove(&p);
        }
    }
    #[action]
    fn requestHash(key: u32, path: Vec<u32>, hash: String) -> u64 {
        let k = KeyTable::read()
            .get_index_pk()
            .get(&key)
            .expect("Unknown signing key");
        assert_eq!(
            get_sender(),
            k.owner,
            "Only key owner may request signatures"
        );
        assert!(!k.public_root.is_empty(), "Public key is not ready");
        must(signing_core::valid_hash(&hash));
        let public_key = must(signing_core::child_public(&k.public_root, &path));
        let mut c = config();
        let id = c.next_request;
        c.next_request = c
            .next_request
            .checked_add(1)
            .expect("Signing request IDs exhausted");
        HashRequestTable::read_write()
            .put(&HashRequest {
                id,
                key,
                provider: k.provider,
                path,
                hash,
                public_key,
                requested_block: psibase::services::transact::Wrapper::call()
                    .currentBlock()
                    .blockNum,
                signature: String::new(),
                complete: false,
            })
            .unwrap();
        SigningConfigTable::read_write().put(&c).unwrap();
        id
    }
    #[action]
    fn publishSig(request: u64, signature: String) {
        let mut r = HashRequestTable::read()
            .get_index_pk()
            .get(&request)
            .expect("Unknown hash request");
        assert!(r.signature.is_empty(), "Signature already published");
        assert!(
            psibase::services::transact::Wrapper::call()
                .currentBlock()
                .commitNum
                >= r.requested_block,
            "Signing request is not final"
        );
        must(signing_core::verify(&r.public_key, &r.hash, &signature));
        r.signature = signature;
        r.complete = true;
        HashRequestTable::read_write().put(&r).unwrap();
    }
    #[action]
    fn getKey(key: u32) -> Key {
        KeyTable::read()
            .get_index_pk()
            .get(&key)
            .expect("Unknown signing key")
    }
    #[action]
    fn getRequest(request: u64) -> HashRequest {
        HashRequestTable::read()
            .get_index_pk()
            .get(&request)
            .expect("Unknown hash request")
    }
}
