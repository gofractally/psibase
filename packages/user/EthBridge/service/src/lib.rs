//! Backed 10-gwei-unit token, deterministic 2-of-3 vault batches and proof-only settlement.
use ethbridge_core as bridge;
use ethrelay_core as eth;
use psibase::services::{nft::Wrapper as Nft, tokens::Wrapper as Tokens};
use psibase::*;
use serde::{Deserialize, Serialize};
#[psibase::service_tables]
pub mod tables {
    use super::*;
    #[table(name = "ConfigTable", index = 0)]
    #[derive(Clone, Debug, Pack, Unpack, ToSchema, Serialize, Deserialize, psio::PsszPack, psio::PsszUnpack, psio::PsszView, psio::ToPsszSchema, psio::JsonText)]
    pub struct Config {
        pub chain_id: u64,
        pub deployment: String,
        pub vault: String,
        pub code_hash: String,
        pub token: u32,
        pub treasury: AccountNumber,
        pub fee_bps: u16,
        pub publisher_bps: u16,
        pub withdrawal_fee: u64,
        pub batch_size: u32,
        pub next_request: u64,
        pub next_batch: u64,
        pub active: Option<u64>,
        pub reserve: u64,
        pub liability: u64,
        pub escrow: u64,
        pub paused: bool,
    }
    impl Config {
        #[primary_key]
        fn pk(&self) {}
    }
    #[table(name = "CustodyTable", index = 1)]
    #[derive(Clone, Debug, Pack, Unpack, ToSchema, Serialize, Deserialize, psio::PsszPack, psio::PsszUnpack, psio::PsszView, psio::ToPsszSchema, psio::JsonText)]
    pub struct Custody {
        #[primary_key]
        pub index: u8,
        pub key: u32,
        pub provider: AccountNumber,
        pub public: String,
        pub address: String,
    }
    #[table(name = "DepositTable", index = 2)]
    #[derive(Clone, Debug, Pack, Unpack, ToSchema, Serialize, Deserialize, psio::PsszPack, psio::PsszUnpack, psio::PsszView, psio::ToPsszSchema, psio::JsonText)]
    pub struct Deposit {
        #[primary_key]
        pub id: u64,
        pub owner: AccountNumber,
        pub amount: u64,
        pub credited: u64,
        pub fee: u64,
        pub bounty: u64,
        pub publisher: AccountNumber,
        pub block: String,
        pub transaction_index: u64,
        pub log_index: u32,
    }
    impl Deposit {
        #[secondary_key(1)]
        fn by_owner(&self) -> (AccountNumber, u64) {
            (self.owner, self.id)
        }
    }
    #[table(name = "RequestTable", index = 3)]
    #[derive(Clone, Debug, Pack, Unpack, ToSchema, Serialize, Deserialize, psio::PsszPack, psio::PsszUnpack, psio::PsszView, psio::ToPsszSchema, psio::JsonText)]
    pub struct Request {
        #[primary_key]
        pub id: u64,
        pub owner: AccountNumber,
        pub address: String,
        pub amount: u64,
        pub fee: u64,
        pub created: u64,
        pub status: u8,
        pub batch: Option<u64>,
    }
    impl Request {
        #[secondary_key(1)]
        fn by_status(&self) -> (u8, u64) {
            (self.status, self.id)
        }
        #[secondary_key(2)]
        fn by_owner(&self) -> (AccountNumber, u64) {
            (self.owner, self.id)
        }
    }
    #[table(name = "BatchTable", index = 4)]
    #[derive(Clone, Debug, Pack, Unpack, ToSchema, Serialize, Deserialize, psio::PsszPack, psio::PsszUnpack, psio::PsszView, psio::ToPsszSchema, psio::JsonText)]
    pub struct Batch {
        #[primary_key]
        pub nonce: u64,
        pub payments: String,
        pub payments_hash: String,
        pub digest: String,
        pub total: u64,
        pub requests: Vec<u64>,
        pub signing_requests: Vec<u64>,
        pub signatures: Vec<String>,
        pub calldata: String,
        pub status: u8,
        pub block: String,
    }
}
pub use tables::*;
fn must<T>(r: eth::Result<T>) -> T {
    ethrelay::must(r)
}
fn plus(a: u64, b: u64) -> u64 {
    a.checked_add(b).expect("ETH accounting overflow")
}
pub fn config() -> Config {
    ConfigTable::read()
        .get_index_pk()
        .get(&())
        .expect("ETH bridge not initialized")
}
fn audit(c: &Config) {
    assert_eq!(c.reserve, c.liability, "ETH reserve/liability mismatch");
    assert_eq!(
        Tokens::call()
            .getSubBal(c.token, "withdrawals".into())
            .map(|a| a.value)
            .unwrap_or(0),
        c.escrow,
        "ETH withdrawal escrow mismatch"
    );
    let t = Tokens::call().getToken(c.token);
    assert!(
        t.issued_supply.value - t.burned_supply.value <= c.liability,
        "Unbacked ETH token supply"
    );
}
fn save(c: &Config) {
    audit(c);
    ConfigTable::read_write().put(c).unwrap();
}
fn live() -> Config {
    let c = config();
    assert!(!c.paused, "ETH bridge paused");
    let _ = ethrelay::Wrapper::call().assertLive();
    audit(&c);
    c
}
fn credit(c: &Config, owner: AccountNumber, n: u64, memo: &str) {
    if n > 0 {
        Tokens::call().credit(c.token, owner, n.into(), memo.into());
    }
}
fn receipt(block: &str, fact: &str) -> eth::ReceiptFact {
    let h = ethrelay::Wrapper::call().check(block.into());
    let eth::Fact::Receipt(f) = ethrelay::evidence(fact) else {
        panic!("Receipt evidence required")
    };
    assert_eq!(
        h.receipts_root, f.receipts_root,
        "Receipt does not belong to authenticated Ethereum block"
    );
    f
}
// Runtime hash generated reproducibly from the pinned Solidity compiler.
pub const VAULT_CODE_HASH: &str = include_str!("../../contracts/runtime.keccak");
#[psibase::service(name = "ethbridge", tables = "tables")]
#[allow(non_snake_case)]
pub mod service {
    use super::*;
    #[action]
    fn requestKeys(providers: Vec<AccountNumber>) -> Vec<u32> {
        assert_eq!(get_sender(), Wrapper::SERVICE, "ETH key request authority");
        assert_eq!(providers.len(), 3, "Three ETH custody providers required");
        assert!(
            ConfigTable::read().get_index_pk().get(&()).is_none(),
            "ETH bridge already initialized"
        );
        let mut distinct = providers.clone();
        distinct.sort_by_key(|a| a.value);
        distinct.dedup();
        assert_eq!(distinct.len(), 3, "Independent ETH providers required");
        providers
            .into_iter()
            .enumerate()
            .map(|(i, provider)| {
                assert!(
                    CustodyTable::read()
                        .get_index_pk()
                        .get(&(i as u8))
                        .is_none(),
                    "Custody keys already requested"
                );
                let key = signing::Wrapper::call().newKey(provider);
                CustodyTable::read_write()
                    .put(&Custody {
                        index: i as u8,
                        key,
                        provider,
                        public: String::new(),
                        address: String::new(),
                    })
                    .unwrap();
                key
            })
            .collect()
    }
    #[action]
    fn init(
        chain_id: u64,
        deployment: String,
        vault: String,
        block: String,
        account_fact: String,
        configured_fact: String,
        treasury: AccountNumber,
        batch_size: u32,
        withdrawal_fee: u64,
    ) {
        assert_eq!(
            get_sender(),
            Wrapper::SERVICE,
            "ETH bridge initialization authority"
        );
        assert!(
            ConfigTable::read().get_index_pk().get(&()).is_none(),
            "ETH bridge already initialized"
        );
        assert!(
            chain_id > 0 && (1..=32).contains(&batch_size),
            "ETH initialization policy"
        );
        let deployment = eth::hex(must(eth::bytes::<32>(&deployment)));
        assert_ne!(
            deployment,
            "00".repeat(32),
            "ETH deployment identity required"
        );
        let vault = must(bridge::address(&vault));
        let h = ethrelay::Wrapper::call().check(block.clone());
        let eth::Fact::Account(a) = ethrelay::evidence(&account_fact) else {
            panic!("Vault account evidence required")
        };
        assert_eq!(
            (a.state_root, a.address),
            (h.state_root, vault.clone()),
            "Vault account anchor mismatch"
        );
        assert_eq!(
            a.code_hash,
            VAULT_CODE_HASH.trim(),
            "Unreviewed ETH vault runtime"
        );
        let f = receipt(&block, &configured_fact);
        let (identity, chain, addresses) = must(bridge::configured(&f, &vault));
        assert_eq!(
            (identity, chain),
            (deployment.clone(), chain_id),
            "ETH vault deployment/network mismatch"
        );
        for i in 0..3u8 {
            let mut custody = CustodyTable::read()
                .get_index_pk()
                .get(&i)
                .expect("Request ETH custody keys first");
            let key = signing::Wrapper::call().getKey(custody.key);
            assert_eq!(
                (key.owner, key.provider),
                (Wrapper::SERVICE, custody.provider),
                "ETH signing key owner/provider mismatch"
            );
            custody.public = must(signing_core::child_public(&key.public_root, &[0, 0]));
            custody.address = must(bridge::public_address(&custody.public));
            assert_eq!(
                custody.address, addresses[i as usize],
                "Vault signer differs from bridge-owned key"
            );
            CustodyTable::read_write().put(&custody).unwrap();
        }
        let t = Tokens::call();
        let token = t.create(8.try_into().unwrap(), u64::MAX.into());
        Nft::call().debit(t.getToken(token).nft_id, "ETH bridge mint authority".into());
        t.setTokenConf(token, 1, true);
        t.setUserConf(0, false);
        t.createSub("withdrawals".into());
        let c = Config {
            chain_id,
            deployment,
            vault,
            code_hash: a.code_hash,
            token,
            treasury,
            fee_bps: 10,
            publisher_bps: 5000,
            withdrawal_fee,
            batch_size,
            next_request: 1,
            next_batch: 0,
            active: None,
            reserve: 0,
            liability: 0,
            escrow: 0,
            paused: false,
        };
        save(&c);
    }
    #[action]
    fn deposit(block: String, fact_json: String) {
        let mut c = live();
        let f = receipt(&block, &fact_json);
        let (id, owner, amount) = must(bridge::deposit(&f, &c.vault));
        assert!(
            DepositTable::read().get_index_pk().get(&id).is_none(),
            "ETH deposit already credited"
        );
        let owner = AccountNumber::new(owner);
        let (net, treasury, bounty) = must(bridge::split(amount, c.fee_bps, c.publisher_bps));
        c.reserve = plus(c.reserve, amount);
        c.liability = plus(c.liability, amount);
        Tokens::call().mint(c.token, amount.into(), "Proven ETH vault deposit".into());
        credit(&c, owner, net, "ETH deposit net of fee");
        credit(&c, c.treasury, treasury, "ETH deposit service fee");
        credit(&c, get_sender(), bounty, "ETH deposit proof bounty");
        DepositTable::read_write()
            .put(&Deposit {
                id,
                owner,
                amount,
                credited: net,
                fee: amount - net,
                bounty,
                publisher: get_sender(),
                block,
                transaction_index: f.transaction_index,
                log_index: f.log_index,
            })
            .unwrap();
        save(&c);
    }
    #[action]
    fn withdraw(address: String, amount: u64) -> u64 {
        let mut c = live();
        let address = must(bridge::address(&address));
        assert_ne!(address, c.vault, "Use an external ETH recipient");
        assert!(amount > 0, "Empty ETH withdrawal");
        let locked = plus(amount, c.withdrawal_fee);
        Tokens::call().debit(
            c.token,
            get_sender(),
            locked.into(),
            "ETH withdrawal authorization".into(),
        );
        Tokens::call().toSub(c.token, "withdrawals".into(), locked.into());
        c.escrow = plus(c.escrow, locked);
        let id = c.next_request;
        c.next_request = plus(id, 1);
        RequestTable::read_write()
            .put(&Request {
                id,
                owner: get_sender(),
                address,
                amount,
                fee: c.withdrawal_fee,
                created: ethrelay::now(),
                status: 0,
                batch: None,
            })
            .unwrap();
        save(&c);
        id
    }
    #[action]
    fn cancel(request: u64) {
        let mut c = config();
        audit(&c);
        let mut r = RequestTable::read()
            .get_index_pk()
            .get(&request)
            .expect("Unknown ETH request");
        assert_eq!(r.owner, get_sender(), "ETH request owner required");
        assert_eq!(r.status, 0, "Committed ETH withdrawal cannot be cancelled");
        let locked = plus(r.amount, r.fee);
        Tokens::call().fromSub(c.token, "withdrawals".into(), locked.into());
        credit(&c, r.owner, locked, "Cancelled queued ETH withdrawal");
        c.escrow -= locked;
        r.status = 3;
        RequestTable::read_write().put(&r).unwrap();
        save(&c);
    }
    #[action]
    fn makeBatch() -> u64 {
        let mut c = live();
        assert!(c.active.is_none(), "Prior ETH batch must finalize first");
        let requests: Vec<_> = RequestTable::read()
            .get_index_by_status()
            .range((0, 0)..=(0, u64::MAX))
            .take(c.batch_size as usize)
            .collect();
        assert!(!requests.is_empty(), "No queued ETH withdrawals");
        assert!(
            requests.len() == c.batch_size as usize
                || ethrelay::now() >= plus(requests[0].created, 300),
            "ETH batch waits five minutes or request threshold"
        );
        let payments: Vec<_> = requests
            .iter()
            .map(|r| bridge::Payment {
                request: r.id,
                address: r.address.clone(),
                amount: r.amount,
            })
            .collect();
        let total = payments.iter().fold(0, |n, p| plus(n, p.amount));
        let nonce = c.next_batch;
        assert!(nonce < u64::MAX, "ETH batch nonce exhausted");
        let digest = eth::hex(must(bridge::digest(
            c.chain_id,
            &c.vault,
            &c.deployment,
            nonce,
            &payments,
        )));
        let mut signing_requests = vec![];
        for i in 0..3u8 {
            let key = CustodyTable::read().get_index_pk().get(&i).unwrap();
            signing_requests.push(signing::Wrapper::call().requestHash(
                key.key,
                vec![0, 0],
                digest.clone(),
            ));
        }
        for mut r in requests.clone() {
            r.status = 1;
            r.batch = Some(nonce);
            RequestTable::read_write().put(&r).unwrap();
        }
        BatchTable::read_write()
            .put(&Batch {
                nonce,
                payments: serde_json::to_string(&payments).unwrap(),
                payments_hash: eth::hex(must(bridge::payments_hash(&payments))),
                digest,
                total,
                requests: requests.iter().map(|r| r.id).collect(),
                signing_requests,
                signatures: vec![String::new(); 3],
                calldata: String::new(),
                status: 0,
                block: String::new(),
            })
            .unwrap();
        c.active = Some(nonce);
        save(&c);
        nonce
    }
    #[action]
    fn gather(batch: u64, signer: u8) {
        let c = live();
        assert!(signer < 3, "ETH signer index");
        let mut b = BatchTable::read()
            .get_index_pk()
            .get(&batch)
            .expect("Unknown ETH batch");
        assert_eq!(b.status, 0, "ETH batch already finalized");
        let key = CustodyTable::read().get_index_pk().get(&signer).unwrap();
        let r = signing::Wrapper::call().getRequest(b.signing_requests[signer as usize]);
        assert!(
            r.complete
                && r.key == key.key
                && r.path == vec![0, 0]
                && r.public_key == key.public
                && r.hash == b.digest,
            "ETH signature request binding"
        );
        b.signatures[signer as usize] =
            must(bridge::recoverable(&key.public, &b.digest, &r.signature));
        let mut ready: Vec<_> = b
            .signatures
            .iter()
            .enumerate()
            .filter(|(_, s)| !s.is_empty())
            .map(|(i, s)| {
                (
                    CustodyTable::read()
                        .get_index_pk()
                        .get(&(i as u8))
                        .unwrap()
                        .address,
                    s.clone(),
                )
            })
            .collect();
        ready.sort_by(|a, b| a.0.cmp(&b.0));
        if ready.len() >= 2 {
            let p: Vec<bridge::Payment> = serde_json::from_str(&b.payments).unwrap();
            b.calldata = must(bridge::calldata(
                b.nonce,
                &p,
                &ready[..2].iter().map(|s| s.1.clone()).collect::<Vec<_>>(),
            ));
        }
        BatchTable::read_write().put(&b).unwrap();
        save(&c);
    }
    #[action]
    fn complete(batch: u64, block: String, fact_json: String) {
        let mut c = live();
        let mut b = BatchTable::read()
            .get_index_pk()
            .get(&batch)
            .expect("Unknown ETH batch");
        assert_eq!(b.status, 0, "ETH batch already completed");
        assert_eq!(c.active, Some(batch), "ETH batch nonce mismatch");
        let f = receipt(&block, &fact_json);
        let (nonce, hash, total) = must(bridge::completed(&f, &c.vault));
        assert_eq!(
            (nonce, hash, total),
            (batch, b.payments_hash.clone(), b.total),
            "ETH vault executed different payments"
        );
        for id in &b.requests {
            let mut r = RequestTable::read().get_index_pk().get(id).unwrap();
            assert_eq!(
                (r.status, r.batch),
                (1, Some(batch)),
                "ETH withdrawal reservation mismatch"
            );
            let locked = plus(r.amount, r.fee);
            Tokens::call().fromSub(c.token, "withdrawals".into(), locked.into());
            Tokens::call().burn(
                c.token,
                r.amount.into(),
                "Finalized ETH allocated to recipient".into(),
            );
            credit(&c, c.treasury, r.fee, "ETH withdrawal service fee");
            c.escrow -= locked;
            r.status = 2;
            RequestTable::read_write().put(&r).unwrap();
        }
        c.reserve -= total;
        c.liability -= total;
        c.active = None;
        c.next_batch = plus(batch, 1);
        b.status = 1;
        b.block = block;
        BatchTable::read_write().put(&b).unwrap();
        save(&c);
    }
    /// Permissionless relay coordination under this app's native wallet namespace.
    #[action]
    fn relay(fact_json: String, child: Option<String>) {
        match ethrelay::evidence(&fact_json) {
            eth::Fact::Update(_) => {
                assert!(child.is_none(), "Unexpected relay child");
                ethrelay::Wrapper::call().update(fact_json);
            }
            eth::Fact::Header(_) => ethrelay::Wrapper::call()
                .backfill(child.expect("Authenticated child required"), fact_json),
            _ => panic!("Unsupported relay evidence"),
        }
    }

    #[action]
    fn getState() -> Config {
        config()
    }
}
#[cfg(all(test, target_family = "wasm"))]
mod tests;
