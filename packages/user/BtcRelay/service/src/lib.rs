//! Permissionless, checkpoint-anchored Bitcoin header relay. Mainnet, signet and regtest have disjoint rules.
//! A signet header is accepted only with its coinbase transaction and Merkle branch, from which the
//! block signature (BIP 325) is verified in addition to proof of work.
use btcbridge_core as btc;
use psibase::*;

#[psibase::service_tables]
pub mod tables {
    use super::*;
    #[table(name = "RelayTable", index = 0)]
    #[derive(Clone, Debug, psio::PsszPack, psio::PsszUnpack, psio::PsszView, psio::ToPsszSchema, psio::JsonText, psio::Serde)]
    pub struct Relay {
        pub network: String,
        pub checkpoint: String,
        pub checkpoint_height: u32,
        pub tip: String,
        pub height: u32,
        pub required: u32,
        pub protected_height: u32,
        pub paused: bool,
        pub reason: String,
    }
    impl Relay {
        #[primary_key]
        fn pk(&self) {}
    }
    #[table(name = "HeaderTable", index = 1)]
    #[derive(Clone, Debug, psio::PsszPack, psio::PsszUnpack, psio::PsszView, psio::ToPsszSchema, psio::JsonText, psio::Serde)]
    pub struct HeaderRow {
        #[primary_key]
        pub id: String,
        pub parent: String,
        pub height: u32,
        pub raw: String,
        pub chainwork: String,
        pub times: Vec<u32>,
        pub epoch_start: u32,
    }
    #[table(name = "CanonicalTable", index = 2)]
    #[derive(Clone, Debug, psio::PsszPack, psio::PsszUnpack, psio::PsszView, psio::ToPsszSchema, psio::JsonText, psio::Serde)]
    pub struct Canonical {
        #[primary_key]
        pub height: u32,
        pub id: String,
    }
    /// A signet header with the proof of its block signature: the raw coinbase transaction and the
    /// coinbase's Merkle branch (transaction-ID hex, leaf to root).
    #[derive(Clone, Debug, psio::PsszPack, psio::PsszUnpack, psio::PsszView, psio::ToPsszSchema, psio::JsonText, psio::Serde)]
    pub struct SignetBlock {
        pub header: String,
        pub coinbase: String,
        pub branch: Vec<String>,
    }
}
pub use tables::*;
fn must<T>(r: btc::Result<T>) -> T {
    r.unwrap_or_else(|e| abort_message(&e))
}
pub fn config() -> Relay {
    RelayTable::read()
        .get_index_pk()
        .get(&())
        .expect("Relay not initialized")
}
pub fn row(id: &str) -> HeaderRow {
    HeaderTable::read()
        .get_index_pk()
        .get(&id.to_string())
        .expect("Unknown Bitcoin header")
}
fn now() -> u64 {
    psibase::services::transact::Wrapper::call()
        .currentBlock()
        .time
        .floor::<psibase::psio::time::Seconds>()
        .ticks() as u64
}
pub fn live() -> Relay {
    let c = config();
    assert!(!c.paused, "Bitcoin relay paused");
    let tip = must(btc::header(&row(&c.tip).raw));
    assert!(
        (tip.time as u64).saturating_add(21600) >= now(),
        "Bitcoin relay is stale"
    );
    c
}
pub fn confirmed(id: &str) -> HeaderRow {
    let c = live();
    let h = row(id);
    assert!(h.height >= c.checkpoint_height, "Proof predates checkpoint");
    assert!(
        c.height
            .checked_sub(h.height)
            .map(|n| n + 1 >= c.required)
            .unwrap_or(false),
        "Insufficient Bitcoin confirmations"
    );
    assert_eq!(
        CanonicalTable::read()
            .get_index_pk()
            .get(&h.height)
            .map(|r| r.id),
        Some(h.id.clone()),
        "Proof is not on selected chain"
    );
    h
}
/// Validate one header against its stored parent, store it and follow the chain with the most work.
/// `signet` carries the block-signature proof on a signed network. Returns false once the relay has
/// paused itself; the caller stores `c` in either case.
fn accept(
    c: &mut Relay,
    raw: String,
    signet: Option<(&btc::SignetParams, &str, &[String])>,
) -> bool {
    let h = must(btc::header(&raw));
    let id = h.block_hash().to_string();
    if HeaderTable::read().get_index_pk().get(&id).is_some() {
        return true;
    }
    let parent = row(&h.prev_blockhash.to_string());
    assert!(
        parent.height >= c.checkpoint_height,
        "Fork precedes relay checkpoint"
    );
    let height = parent
        .height
        .checked_add(1)
        .expect("Bitcoin height overflow");
    let parent_header = must(btc::header(&parent.raw));
    must(btc::validate_next_header(
        &raw,
        height,
        &parent_header,
        &parent.times,
        parent.epoch_start,
        &c.network,
        now(),
    ));
    if let Some((params, coinbase, branch)) = signet {
        // Proof of work alone means little on signet: require the block signature.
        must(btc::verify_signet_block(&h, coinbase, branch, params));
    }
    let mut times = parent.times.clone();
    times.push(h.time);
    if times.len() > 11 {
        times.remove(0);
    }
    let epoch_start = if height % 2016 == 0 {
        h.time
    } else {
        parent.epoch_start
    };
    let parent_work = must(btc::work(&parent.chainwork));
    let chainwork = parent_work + h.work();
    assert!(chainwork > parent_work, "Chainwork overflow");
    let candidate = HeaderRow {
        id: id.clone(),
        parent: parent.id,
        height,
        raw,
        chainwork: btc::work_hex(chainwork),
        times,
        epoch_start,
    };
    HeaderTable::read_write().put(&candidate).unwrap();
    if chainwork <= must(btc::work(&row(&c.tip).chainwork)) {
        return true;
    }
    let mut path = vec![];
    let mut cursor = candidate;
    while CanonicalTable::read()
        .get_index_pk()
        .get(&cursor.height)
        .map(|v| v.id)
        != Some(cursor.id.clone())
    {
        if path.len() >= 129 {
            c.paused = true;
            c.reason = "Higher-work fork exceeds bounded reorganization window".into();
            return false;
        }
        path.push(cursor.clone());
        cursor = row(&cursor.parent);
    }
    if cursor.height < c.protected_height {
        c.paused = true;
        c.reason = format!(
            "Higher-work fork removes accepted Bitcoin state at height {}",
            c.protected_height
        );
        return false;
    }
    for old in height + 1..=c.height {
        if let Some(r) = CanonicalTable::read().get_index_pk().get(&old) {
            CanonicalTable::read_write().remove(&r);
        }
    }
    for h in path {
        CanonicalTable::read_write()
            .put(&Canonical {
                height: h.height,
                id: h.id,
            })
            .unwrap();
    }
    c.tip = id;
    c.height = height;
    true
}
#[psibase::service(name = "btcrelay", tables = "tables")]
#[allow(non_snake_case)]
pub mod service {
    use super::*;
    #[action]
    fn init(network: String, checkpoint_height: u32, context: Vec<String>, required: u32) {
        assert_eq!(
            get_sender(),
            Wrapper::SERVICE,
            "Relay initialization authority"
        );
        assert!(
            RelayTable::read().get_index_pk().get(&()).is_none(),
            "Relay already initialized"
        );
        // Rejects unsupported networks; signet and bitcoin need the checkpoint's difficulty-epoch start.
        let needed = must(btc::context_start(&network, checkpoint_height));
        assert!((1..=144).contains(&required), "Confirmation policy range");
        assert!(
            !context.is_empty()
                && context.len() <= 2027
                && context.len() as u32 <= checkpoint_height + 1,
            "Checkpoint context bounds"
        );
        let start = checkpoint_height + 1 - context.len() as u32;
        assert!(
            start <= needed,
            "Checkpoint lacks timestamp/difficulty context"
        );
        let mut times = Vec::new();
        let mut epoch_start = 0;
        let mut previous = None;
        let mut sum = btc::work(&"00".repeat(32)).unwrap();
        let mut tip = String::new();
        for (n, raw) in context.iter().enumerate() {
            let h = must(btc::header(raw));
            must(btc::check_pow(&h, &network));
            if let Some(id) = previous {
                assert_eq!(h.prev_blockhash, id, "Checkpoint context is not linked");
            }
            let height = start + n as u32;
            if height % 2016 == 0 {
                epoch_start = h.time;
            }
            times.push(h.time);
            if times.len() > 11 {
                times.remove(0);
            }
            tip = h.block_hash().to_string();
            sum = sum + h.work();
            previous = Some(h.block_hash());
            HeaderTable::read_write()
                .put(&HeaderRow {
                    id: tip.clone(),
                    parent: h.prev_blockhash.to_string(),
                    height,
                    raw: raw.clone(),
                    chainwork: btc::work_hex(sum),
                    times: times.clone(),
                    epoch_start,
                })
                .unwrap();
            CanonicalTable::read_write()
                .put(&Canonical {
                    height,
                    id: tip.clone(),
                })
                .unwrap();
        }
        RelayTable::read_write()
            .put(&Relay {
                network,
                checkpoint: tip.clone(),
                checkpoint_height,
                tip,
                height: checkpoint_height,
                required,
                protected_height: checkpoint_height,
                paused: false,
                reason: String::new(),
            })
            .unwrap();
    }
    #[action]
    fn headers(headers: Vec<String>) {
        assert!(
            !headers.is_empty() && headers.len() <= 32,
            "Header submission limit"
        );
        let mut c = config();
        assert!(!c.paused, "Relay paused");
        assert!(
            must(btc::signet_params(&c.network)).is_none(),
            "Signet headers need their block-signature proof: use signetHeaders"
        );
        for raw in headers {
            if !accept(&mut c, raw, None) {
                break;
            }
        }
        RelayTable::read_write().put(&c).unwrap();
    }
    /// Signet: each header with its coinbase transaction and the coinbase's Merkle branch. The
    /// block signature is verified and the proof discarded; only the header is stored.
    #[action]
    fn signetHeaders(blocks: Vec<SignetBlock>) {
        assert!(
            !blocks.is_empty() && blocks.len() <= 16,
            "Header submission limit"
        );
        let mut c = config();
        assert!(!c.paused, "Relay paused");
        let params = must(btc::signet_params(&c.network)).expect("Not a signet relay");
        for b in blocks {
            if !accept(&mut c, b.header, Some((&params, b.coinbase.as_str(), b.branch.as_slice()))) {
                break;
            }
        }
        RelayTable::read_write().put(&c).unwrap();
    }
    #[action]
    fn protect(block: String) {
        assert_eq!(
            get_sender(),
            account!("btcbridge"),
            "Only bridge can protect accepted state"
        );
        let h = confirmed(&block);
        let mut c = config();
        c.protected_height = c.protected_height.max(h.height);
        RelayTable::read_write().put(&c).unwrap();
    }
    /// The relay's own account may change how many confirmations a proof needs, within the
    /// range init accepts. Nothing already accepted is undone.
    #[action]
    fn setRequired(required: u32) {
        assert_eq!(
            get_sender(),
            Wrapper::SERVICE,
            "Relay confirmation policy authority"
        );
        assert!((1..=144).contains(&required), "Confirmation policy range");
        let mut c = config();
        c.required = required;
        RelayTable::read_write().put(&c).unwrap();
    }
    #[action]
    fn check(block: String) -> HeaderRow {
        confirmed(&block)
    }
    #[action]
    fn getState() -> Relay {
        config()
    }
    #[action]
    fn assertLive() {
        live();
    }
}
