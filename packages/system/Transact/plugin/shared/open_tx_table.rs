use crate::bindings::host::db::store::{Bucket, Database, DbMode, StorageDuration};
use psibase::fracpack::{Pack, UnpackOwned};
use psibase::{Action, Claim, Hex, MethodNumber};
#[path = "transaction_policy.rs"]
mod policy;
use policy::{register_hook, ConnectionPin};

const ACTIONS: &str = "actions";
const CLAIMS: &str = "claims";
const EVIDENCE: &str = "evidence";
const LATCH_SENDER: &str = "latch-sender";
const LATCH_ACTIONS: &str = "latch-actions";
const SENDER_HOOK: &str = "sender-hook";
const PRE_PUBLISH_HOOKS: &str = "pre-publish-hooks";
const PUBLICATION_STARTED: &str = "publication-started";
const CONNECTION: &str = "connection";

// The transaction currently being built. Ephemeral, so start-tx's clear-buffers drops it.
pub(crate) fn open_tx_table() -> Bucket {
    Bucket::new(
        Database {
            mode: DbMode::NonTransactional,
            duration: StorageDuration::Ephemeral,
        },
        "open-tx",
    )
}

fn load<T: UnpackOwned>(key: &str) -> Option<T> {
    open_tx_table()
        .get(key)
        .map(|bytes| T::unpacked(&bytes).unwrap())
}

fn store<T: Pack>(key: &str, value: &T) {
    open_tx_table().set(key, &value.packed());
}

fn connection() -> Option<ConnectionPin> {
    load::<(bool, Option<String>)>(CONNECTION).map(|(bound, user)| ConnectionPin { bound, user })
}

fn store_connection(pin: ConnectionPin) {
    store(CONNECTION, &(pin.bound, pin.user));
}

pub(crate) struct OpenTx;

#[allow(dead_code)]
impl OpenTx {
    pub(crate) fn initialize_connection(user: Option<String>) {
        store_connection(ConnectionPin::at_start(user));
    }

    pub(crate) fn check_connection(current: Option<String>) -> Result<(), &'static str> {
        let mut pin = connection().ok_or("no active transaction connection")?;
        pin.bind_or_check(current)?;
        store_connection(pin);
        Ok(())
    }

    pub(crate) fn validate_connection(current: Option<String>) -> Result<(), &'static str> {
        let pin = connection().ok_or("no active transaction connection")?;
        pin.validate(current.as_deref())
    }

    pub(crate) fn connection_user() -> Option<String> {
        connection().and_then(|pin| pin.user)
    }

    pub(crate) fn publication_started() -> bool {
        load(PUBLICATION_STARTED).unwrap_or(false)
    }

    pub(crate) fn register_pre_publish_hook(service: &str) -> Result<(), &'static str> {
        let mut hooks = load(PRE_PUBLISH_HOOKS).unwrap_or_default();
        register_hook(&mut hooks, service, Self::publication_started())?;
        store(PRE_PUBLISH_HOOKS, &hooks);
        Ok(())
    }

    pub(crate) fn begin_pre_publish() -> Vec<String> {
        assert!(
            !Self::publication_started(),
            "pre-publication hooks already running"
        );
        store(PUBLICATION_STARTED, &true);
        load(PRE_PUBLISH_HOOKS).unwrap_or_default()
    }

    pub(crate) fn add_action(action: Action) {
        let mut actions: Vec<Action> = load(ACTIONS).unwrap_or_default();
        actions.push(action);
        store(ACTIONS, &actions);
    }

    pub(crate) fn take_actions() -> Vec<Action> {
        let actions = load(ACTIONS).unwrap_or_default();
        open_tx_table().delete(ACTIONS);
        actions
    }

    pub(crate) fn add_claim(claim: Claim) {
        let mut claims: Vec<Claim> = load(CLAIMS).unwrap_or_default();
        claims.push(claim);
        store(CLAIMS, &claims);
    }

    pub(crate) fn take_claims() -> Vec<Claim> {
        let claims = load(CLAIMS).unwrap_or_default();
        open_tx_table().delete(CLAIMS);
        claims
    }

    pub(crate) fn add_evidence(claim: Claim, proof: Hex<Vec<u8>>) -> Result<(), &'static str> {
        if Self::publication_started() { return Err("cannot add evidence during publication"); }
        let mut entries: Vec<(Claim, Hex<Vec<u8>>)> = load(EVIDENCE).unwrap_or_default();
        if entries.len() >= 8 || claim.rawData.0.len() > 65536 || proof.0.len() > 262144 {
            return Err("evidence count or entry size limit");
        }
        let bytes: usize = entries.iter().map(|(c,p)|c.rawData.0.len()+p.0.len()).sum();
        if bytes + claim.rawData.0.len() + proof.0.len() > 1_048_576 {
            return Err("total evidence size limit");
        }
        entries.push((claim,proof)); store(EVIDENCE,&entries); Ok(())
    }

    pub(crate) fn take_evidence() -> Vec<(Claim, Hex<Vec<u8>>)> {
        let entries=load(EVIDENCE).unwrap_or_default();
        open_tx_table().delete(EVIDENCE); entries
    }

    pub(crate) fn latch_sender() -> Option<String> {
        load(LATCH_SENDER)
    }

    pub(crate) fn latch_is_active() -> bool {
        Self::latch_sender().is_some()
    }

    pub(crate) fn open_latch(sender: String) {
        assert!(
            Self::latch_sender().is_none(),
            "open_latch called while a latch is open"
        );
        store(LATCH_SENDER, &sender);
        open_tx_table().delete(LATCH_ACTIONS);
    }

    pub(crate) fn add_latched(action: Action) -> bool {
        if Self::latch_sender().is_none() {
            return false;
        }
        let mut actions: Vec<Action> = load(LATCH_ACTIONS).unwrap_or_default();
        actions.push(action);
        store(LATCH_ACTIONS, &actions);
        true
    }

    pub(crate) fn take_latch() -> Option<Vec<Action>> {
        Self::latch_sender()?;
        let actions = load(LATCH_ACTIONS).unwrap_or_default();
        open_tx_table().delete(LATCH_SENDER);
        open_tx_table().delete(LATCH_ACTIONS);
        Some(actions)
    }

    pub(crate) fn flush_latch(proposer: Option<&str>) -> Result<(), ()> {
        let Some(actions) = Self::take_latch() else {
            return Ok(());
        };
        if actions.is_empty() {
            return Ok(());
        }
        let Some(proposer) = proposer else {
            // Latch is already consumed.
            return Err(());
        };

        let packed = psibase::services::staged_tx::action_structs::propose {
            actions,
            auto_exec: true,
        }
        .packed();
        Self::add_action(Action {
            sender: proposer.parse().unwrap(),
            service: psibase::services::staged_tx::SERVICE,
            method: MethodNumber::from(
                psibase::services::staged_tx::action_structs::propose::ACTION_NAME,
            ),
            rawData: Hex::from(packed),
        });
        Ok(())
    }

    pub(crate) fn set_sender_hook(plugin: String) {
        store(SENDER_HOOK, &plugin);
    }

    pub(crate) fn sender_hook() -> Option<String> {
        load(SENDER_HOOK)
    }

    pub(crate) fn clear_sender_hook() {
        open_tx_table().delete(SENDER_HOOK);
    }
}
