//! Only evidence binding, committee progression and bounded root storage execute
//! sequentially. BLS, SSZ, RLP and MPT are verified by verify-eth proofs first.
use ethrelay_core as eth;
use psibase::*;
#[psibase::service_tables]
pub mod tables {
    use super::*;
    #[table(name = "RelayTable", index = 0)]
    #[derive(Clone, Debug, psio::PsszPack, psio::PsszUnpack, psio::PsszView, psio::ToPsszSchema, psio::JsonText, psio::Serde)]
    pub struct Relay {
        pub network: String,
        pub network_hash: String,
        pub checkpoint: String,
        pub period: u64,
        pub current: String,
        pub next: Option<String>,
        pub finalized_slot: u64,
        pub finalized_root: String,
        pub trust_slots: u64,
        pub live_slots: u64,
        pub history_limit: u32,
        pub history_sequence: u64,
        pub paused: bool,
        pub reason: String,
    }
    impl Relay {
        #[primary_key]
        fn pk(&self) {}
    }
    #[table(name = "HeaderTable", index = 1)]
    #[derive(Clone, Debug, psio::PsszPack, psio::PsszUnpack, psio::PsszView, psio::ToPsszSchema, psio::JsonText, psio::Serde)]
    pub struct Header {
        #[primary_key]
        pub hash: String,
        pub parent: String,
        pub number: u64,
        pub state_root: String,
        pub receipts_root: String,
    }
    #[table(name = "RingTable", index = 2)]
    #[derive(Clone, Debug, psio::PsszPack, psio::PsszUnpack, psio::PsszView, psio::ToPsszSchema, psio::JsonText, psio::Serde)]
    pub struct Ring {
        #[primary_key]
        pub index: u32,
        pub hash: String,
    }
}
pub use tables::*;
pub fn must<T>(r: eth::Result<T>) -> T {
    r.unwrap_or_else(|e| abort_message(&e))
}
pub fn config() -> Relay {
    RelayTable::read()
        .get_index_pk()
        .get(&())
        .expect("Ethereum relay not initialized")
}
pub fn now() -> u64 {
    psibase::services::transact::Wrapper::call()
        .currentBlock()
        .time
        .floor::<psibase::psio::time::Seconds>()
        .ticks() as u64
}
fn slot(c: &Relay) -> u64 {
    let n: eth::Network = serde_json::from_str(&c.network).unwrap();
    must(n.slot(now()))
}
pub fn live() -> Relay {
    let c = config();
    assert!(!c.paused, "Ethereum relay paused");
    assert!(
        slot(&c).saturating_sub(c.finalized_slot) <= c.live_slots,
        "Ethereum finality is stale"
    );
    c
}
/// Proofs establish this commitment before objective execution. A proof may be
/// replayed as evidence; application state still controls whether facts apply.
pub fn evidence(fact_json: &str) -> eth::Fact {
    assert!(fact_json.len() <= 32768, "Ethereum fact size limit");
    let fact: eth::Fact = serde_json::from_str(fact_json).expect("Invalid Ethereum fact");
    let expected = fact.commitment();
    let trx = psibase::services::transact::Wrapper::call().getTransaction();
    assert!(
        trx.claims
            .iter()
            .any(|c| c.service == account!("verify-eth") && c.rawData.as_slice() == expected),
        "Missing verified Ethereum evidence claim"
    );
    fact
}
fn remember(c: &mut Relay, e: &eth::ExecutionFact) {
    let h = Header {
        hash: e.block_hash.clone(),
        parent: e.parent_hash.clone(),
        number: e.block_number,
        state_root: e.state_root.clone(),
        receipts_root: e.receipts_root.clone(),
    };
    if let Some(old) = HeaderTable::read().get_index_pk().get(&h.hash) {
        assert_eq!(
            serde_json::to_string(&old).unwrap(),
            serde_json::to_string(&h).unwrap(),
            "Conflicting Ethereum header"
        );
        return;
    }
    let index = (c.history_sequence % u64::from(c.history_limit)) as u32;
    if let Some(old) = RingTable::read().get_index_pk().get(&index) {
        if let Some(h) = HeaderTable::read().get_index_pk().get(&old.hash) {
            HeaderTable::read_write().remove(&h);
        }
    }
    HeaderTable::read_write().put(&h).unwrap();
    RingTable::read_write()
        .put(&Ring {
            index,
            hash: h.hash,
        })
        .unwrap();
    c.history_sequence = c
        .history_sequence
        .checked_add(1)
        .expect("History sequence exhausted");
}
fn freeze(mut c: Relay, message: &str) {
    c.paused = true;
    c.reason = message.into();
    RelayTable::read_write().put(&c).unwrap();
}
#[psibase::service(name = "ethrelay", tables = "tables")]
#[allow(non_snake_case)]
pub mod service {
    use super::*;
    #[action]
    fn init(
        network_json: String,
        checkpoint: String,
        fact_json: String,
        history_limit: u32,
        trust_slots: u64,
        live_slots: u64,
    ) {
        assert_eq!(
            get_sender(),
            Wrapper::SERVICE,
            "Ethereum relay initialization authority"
        );
        assert!(
            RelayTable::read().get_index_pk().get(&()).is_none(),
            "Ethereum relay already initialized"
        );
        assert!(network_json.len() <= 8192, "Network configuration limit");
        let network: eth::Network =
            serde_json::from_str(&network_json).expect("Invalid Ethereum network");
        must(network.validate());
        let checkpoint = eth::hex(must(eth::bytes::<32>(&checkpoint)));
        let eth::Fact::Bootstrap(f) = evidence(&fact_json) else {
            panic!("Bootstrap evidence required")
        };
        assert_eq!(f.network, network.root(), "Bootstrap network mismatch");
        assert_eq!(f.beacon, checkpoint, "Untrusted Ethereum checkpoint");
        assert!(
            (16..=8192).contains(&history_limit)
                && live_slots > 0
                && live_slots <= trust_slots
                && (8192..=57344).contains(&trust_slots),
            "Ethereum resource/trust policy range"
        );
        let current_slot = must(network.slot(now()));
        assert!(
            f.slot <= current_slot && current_slot - f.slot <= live_slots,
            "Bootstrap checkpoint must be recent"
        );
        let mut c = Relay {
            network: serde_json::to_string(&network).unwrap(),
            network_hash: f.network,
            checkpoint,
            period: f.slot / eth::PERIOD,
            current: f.committee,
            next: None,
            finalized_slot: f.slot,
            finalized_root: f.beacon,
            trust_slots,
            live_slots,
            history_limit,
            history_sequence: 0,
            paused: false,
            reason: String::new(),
        };
        remember(&mut c, &f.execution);
        RelayTable::read_write().put(&c).unwrap();
    }
    #[action]
    fn update(fact_json: String) {
        let mut c = config();
        assert!(!c.paused, "Ethereum relay paused");
        let current_slot = slot(&c);
        assert!(
            current_slot.saturating_sub(c.finalized_slot) <= c.trust_slots,
            "Ethereum trust checkpoint expired"
        );
        let eth::Fact::Update(f) = evidence(&fact_json) else {
            panic!("Finality evidence required")
        };
        assert_eq!(
            f.network, c.network_hash,
            "Ethereum update network mismatch"
        );
        assert!(
            f.signature_slot <= current_slot
                && f.signature_slot > f.attested_slot
                && f.attested_slot >= f.finalized_slot,
            "Ethereum update slot order"
        );
        let signature_period = f.signature_slot / eth::PERIOD;
        let final_period = f.finalized_slot / eth::PERIOD;
        let attested_period = f.attested_slot / eth::PERIOD;
        let expected = if signature_period == c.period {
            Some(&c.current)
        } else if signature_period == c.period + 1 {
            c.next.as_ref()
        } else {
            None
        };
        assert_eq!(
            expected,
            Some(&f.committee),
            "Unauthenticated signing committee or skipped period"
        );
        assert!(
            f.finalized_slot >= c.finalized_slot && final_period <= c.period + 1,
            "Ethereum finalized slot regression/skip"
        );
        if f.finalized_slot == c.finalized_slot && f.finalized_root != c.finalized_root {
            freeze(c, "Conflicting signed Ethereum finality");
            return;
        }
        if attested_period == c.period {
            if let Some(next) = &f.next_committee {
                if let Some(old) = &c.next {
                    if old != next {
                        freeze(c, "Conflicting next Ethereum committee");
                        return;
                    }
                } else {
                    c.next = Some(next.clone());
                }
            }
        }
        if final_period == c.period + 1 {
            c.current = c.next.take().expect("Unknown next Ethereum committee");
            c.period = final_period;
            if attested_period == final_period {
                c.next = f.next_committee.clone();
            }
        }
        c.finalized_slot = f.finalized_slot;
        c.finalized_root = f.finalized_root;
        remember(&mut c, &f.execution);
        RelayTable::read_write().put(&c).unwrap();
    }
    #[action]
    fn backfill(child: String, fact_json: String) {
        let mut c = live();
        let child = HeaderTable::read()
            .get_index_pk()
            .get(&child)
            .expect("Unknown authenticated child header");
        let eth::Fact::Header(f) = evidence(&fact_json) else {
            panic!("Execution header evidence required")
        };
        assert_eq!(child.parent, f.block_hash, "Execution ancestry mismatch");
        assert_eq!(
            f.block_number.checked_add(1),
            Some(child.number),
            "Execution block number mismatch"
        );
        remember(&mut c, &f);
        RelayTable::read_write().put(&c).unwrap();
    }
    #[action]
    fn check(block: String) -> Header {
        let _ = live();
        HeaderTable::read()
            .get_index_pk()
            .get(&block)
            .expect("Ethereum header not retained; supply authenticated ancestry")
    }
    #[action]
    fn assertLive() -> Relay {
        live()
    }
    #[action]
    fn getState() -> Relay {
        config()
    }
}
