//! Native token-backed Bitcoin custody bridge. All spending templates are objective chain state.
use btcbridge_core as btc;
use psibase::*;
pub mod tables;
pub use tables::tables::*;
fn must<T>(r: btc::Result<T>) -> T {
    r.unwrap_or_else(|e| abort_message(&e))
}
pub fn config() -> Config {
    ConfigTable::read()
        .get_index_pk()
        .get(&())
        .expect("Bridge not initialized")
}
pub fn policy(c: &Config) -> btc::Policy {
    serde_json::from_str(&c.policy).expect("Stored custody policy")
}
pub fn deposit_fees(at: u64) -> FeeTerms {
    let Some(p) = DepositFeesTable::read().get_index_pk().get(&()) else {
        return FeeTerms::default();
    };
    if p.activates_at <= at {
        p.pending.unwrap_or(p.current)
    } else {
        p.current
    }
}
fn now() -> u64 {
    psibase::services::transact::Wrapper::call()
        .currentBlock()
        .time
        .floor::<psibase::psio::time::Seconds>()
        .ticks() as u64
}
fn live() -> Config {
    let c = config();
    assert!(!c.paused, "Bitcoin bridge paused");
    btcrelay::Wrapper::call().assertLive();
    audit(&c);
    c
}
fn plus(a: u64, b: u64) -> u64 {
    a.checked_add(b).expect("Satoshi overflow")
}
fn save(c: &Config) {
    audit(c);
    ConfigTable::read_write().put(c).unwrap();
}
fn audit(c: &Config) {
    use psibase::services::tokens::Wrapper as Tokens;
    assert_eq!(c.reserve, c.liability, "Tracked Bitcoin reserve mismatch");
    assert_eq!(
        Tokens::call()
            .getSubBal(c.token, "withdrawals".into())
            .map(|q| q.value)
            .unwrap_or(0),
        c.escrow,
        "Native withdrawal escrow changed"
    );
    let t = Tokens::call().getToken(c.token);
    assert!(
        t.issued_supply.value - t.burned_supply.value <= c.liability,
        "Unbacked native token supply"
    );
}
fn credit(token: u32, owner: AccountNumber, amount: u64, memo: &str) {
    if amount > 0 {
        psibase::services::tokens::Wrapper::call().credit(token, owner, amount.into(), memo.into());
    }
}
fn outpoint(txid: &str, vout: u32) -> String {
    format!("{}:{:08x}", txid, vout)
}
fn proof(
    raw: &str,
    block: &str,
    siblings: &[String],
    position: u32,
) -> (btc::bitcoin::Transaction, btcrelay::HeaderRow) {
    let h = btcrelay::Wrapper::call().check(block.to_string());
    let tx = must(btc::prove_transaction(
        raw,
        &must(btc::header(&h.raw)),
        siblings,
        position,
    ));
    (tx, h)
}
fn revision(batch: u32, rev: u32) -> Revision {
    RevisionTable::read()
        .get_index_pk()
        .get(&(batch, rev))
        .expect("Unknown batch revision")
}
fn store_revision(c: &Config, batch: u32, rev: u32, plan: &btc::Plan, p: &btc::Policy) {
    let block = psibase::services::transact::Wrapper::call()
        .currentBlock()
        .blockNum;
    RevisionTable::read_write()
        .put(&Revision {
            batch,
            revision: rev,
            plan: serde_json::to_string(plan).unwrap(),
            policy: serde_json::to_string(p).unwrap(),
            authorized_block: block,
            created: now(),
            raw: String::new(),
        })
        .unwrap();
    TxTable::read_write()
        .put(&TxRecord {
            txid: plan.txid.clone(),
            batch,
            revision: rev,
        })
        .unwrap();
    let script = must(btc::custody_script(p, 1, batch));
    let key = btc::hex::encode(script.as_bytes());
    if ScriptTable::read().get_index_pk().get(&key).is_none() {
        ScriptTable::read_write()
            .put(&CustodyScript {
                script: key,
                branch: 1,
                index: batch,
                owner: Wrapper::SERVICE,
            })
            .unwrap();
    }
    let _ = c;
}
/// A withdrawal request leaves objective state: everything a reader of its history needs goes
/// into the event, and the row is erased. Nothing reads a cancelled request again, and it guards
/// nothing: its funds were returned, and its id is never issued again (`Config.next_request`).
fn retire(r: &Withdrawal, reason: &str, prior_status: u8) {
    Wrapper::emit().history().withdrawalRetired(
        r.id,
        r.owner,
        r.address.clone(),
        r.amount,
        r.max_fee,
        r.service_fee,
        r.created,
        now(),
        reason.to_string(),
        prior_status,
        r.batch,
        r.paid_fee,
        r.txid.clone(),
    );
    RequestTable::read_write().remove(r);
}
/// A deposit's receipt is history: nothing objective reads it (the processed output in
/// `UtxoTable` is the guard), so it is an event.
fn emit_deposit(d: &Deposit) {
    Wrapper::emit().history().depositCredited(
        d.id.clone(),
        d.txid.clone(),
        d.vout,
        d.owner,
        d.address_index,
        d.value,
        d.credited,
        d.fee,
        d.bounty,
        d.publisher.map(|p| p.to_string()).unwrap_or_default(),
        d.fee_bps,
        d.publisher_bps,
        d.height,
        d.block.clone(),
        d.credited_at,
        d.legacy,
    );
}
/// At most this many rows are retired by one ordinary action.
const TIDY_ROWS: usize = 4;
/// Passive cleanup. Rows that reached a final state before their action erased them are retired
/// here, a few at a time and oldest first, inside actions that run anyway: nobody has to call a
/// maintenance action. Added cost per call is bounded: one index read per kind and, for at most
/// `TIDY_ROWS` rows in total, one event and one erase. Later kinds join this list.
fn tidy() {
    let mut left = TIDY_ROWS;
    // Requests cancelled before `cancel` erased them (state 3).
    let cancelled: Vec<_> = RequestTable::read()
        .get_index_by_status()
        .range((3, 0)..=(3, u64::MAX))
        .take(left)
        .collect();
    left -= cancelled.len();
    for r in &cancelled {
        // The state it was cancelled from was not recorded.
        retire(r, "cancelled", 3);
    }
    // Deposit receipts written before a receipt was an event.
    let receipts: Vec<_> = DepositTable::read()
        .get_index_pk()
        .iter()
        .take(left)
        .collect();
    for d in &receipts {
        emit_deposit(d);
        DepositTable::read_write().remove(d);
    }
}
/// The columns history is asked for: a request's id and owner, a deposit's outpoint and owner.
fn index_events() {
    use psibase::services::events;
    for (event, column) in [
        ("withdrawalRetired", 0),
        ("withdrawalRetired", 1),
        ("depositCredited", 0),
        ("depositCredited", 3),
    ] {
        events::Wrapper::call().addIndex(
            events::EventDb::HistoryEvent,
            Wrapper::SERVICE,
            MethodNumber::from(event),
            column,
        );
    }
}
#[psibase::service(name = "btcbridge", tables = "tables::tables")]
#[allow(non_snake_case)]
pub mod service {
    use super::*;
    use psibase::services::{nft::Wrapper as Nft, tokens::Wrapper as Tokens};
    use std::str::FromStr;
    #[action]
    fn createKeys(providers: Vec<AccountNumber>) -> Vec<u32> {
        assert_eq!(
            get_sender(),
            Wrapper::SERVICE,
            "Custody key setup authority"
        );
        assert!(
            CustodyKeyTable::read()
                .get_index_pk()
                .iter()
                .next()
                .is_none(),
            "Custody keys already requested"
        );
        let mut distinct = providers.clone();
        distinct.sort_by_key(|a| a.value);
        distinct.dedup();
        assert_eq!(
            distinct.len(),
            3,
            "Three distinct signing providers required"
        );
        assert_eq!(providers.len(), 3, "Three signing providers required");
        providers
            .into_iter()
            .enumerate()
            .map(|(n, provider)| {
                let key = signing::Wrapper::call().newKey(provider);
                CustodyKeyTable::read_write()
                    .put(&CustodyKey {
                        signer: n as u8,
                        key,
                        provider,
                    })
                    .unwrap();
                key
            })
            .collect()
    }
    #[action]
    fn init(policy_json: String, treasury: AccountNumber) -> u32 {
        assert_eq!(
            get_sender(),
            Wrapper::SERVICE,
            "Bridge initialization authority"
        );
        assert!(
            ConfigTable::read().get_index_pk().get(&()).is_none(),
            "Bridge already initialized"
        );
        let p: btc::Policy = serde_json::from_str(&policy_json).expect("Invalid custody policy");
        must(p.validate());
        for n in 0..3 {
            let custody = CustodyKeyTable::read()
                .get_index_pk()
                .get(&(n as u8))
                .expect("Request custody keys first");
            let key = signing::Wrapper::call().getKey(custody.key);
            assert_eq!(
                key.owner,
                Wrapper::SERVICE,
                "BTC contract must own custody keys"
            );
            assert_eq!(key.provider, custody.provider, "Signing provider changed");
            let mut public = btc::bitcoin::bip32::Xpub::from_str(&key.public_root)
                .expect("Custody public key not ready");
            public.network = must(btc::network(&p.network)).into();
            assert_eq!(
                public.to_string(),
                p.xpubs[n],
                "Policy differs from signing-service public key"
            );
        }
        let relay = btcrelay::Wrapper::call().getState();
        assert_eq!(p.network, relay.network, "Relay network mismatch");
        let t = Tokens::call();
        let token = t.create(8.try_into().unwrap(), u64::MAX.into());
        Nft::call().debit(t.getToken(token).nft_id, "Bridge mint authority".into());
        t.setTokenConf(token, 1, true);
        t.setUserConf(0, false);
        t.createSub("withdrawals".into());
        index_events();
        ConfigTable::read_write()
            .put(&Config {
                policy: serde_json::to_string(&p).unwrap(),
                token,
                treasury,
                next_address: 0,
                next_request: 1,
                next_batch: 1,
                reserve: 0,
                liability: 0,
                escrow: 0,
                paused: false,
                reason: String::new(),
            })
            .unwrap();
        token
    }
    #[action]
    fn newAddress() -> DepositAddress {
        let mut c = live();
        let p = policy(&c);
        let index = c.next_address;
        assert!(index < 1 << 31, "Deposit derivation exhausted");
        let owner = get_sender();
        let address = must(btc::custody_address(&p, 0, index));
        let script = btc::hex::encode(must(btc::custody_script(&p, 0, index)).as_bytes());
        assert!(
            ScriptTable::read().get_index_pk().get(&script).is_none(),
            "Custody script already assigned"
        );
        let row = DepositAddress {
            index,
            owner,
            address,
            script: script.clone(),
        };
        AddressTable::read_write().put(&row).unwrap();
        ScriptTable::read_write()
            .put(&CustodyScript {
                script,
                branch: 0,
                index,
                owner,
            })
            .unwrap();
        c.next_address += 1;
        save(&c);
        row
    }
    /// On a test network the bridge's own account may change the smallest deposit and
    /// withdrawal: the amounts a test faucet pays are far below what suits mainnet, and a
    /// deployment's first choice should not be final there. Refused on mainnet, where these
    /// are fixed at initialization. Nothing else in the custody policy can be changed.
    /// Requests already queued are still paid: a batch enforces only the fixed floor.
    #[action]
    fn setTestMins(min_deposit: u64, min_withdrawal: u64) {
        assert_eq!(get_sender(), Wrapper::SERVICE, "Bridge policy authority");
        let mut c = config();
        let p = must(btc::with_test_minimums(&policy(&c), min_deposit, min_withdrawal));
        c.policy = serde_json::to_string(&p).unwrap();
        ConfigTable::read_write().put(&c).unwrap();
    }
    /// Administration changes are announced a day before becoming effective.
    #[action]
    fn setDepFees(fee_bps: u16, publisher_bps: u16) {
        assert_eq!(
            get_sender(),
            Wrapper::SERVICE,
            "Deposit fee policy authority"
        );
        let _ = config();
        must(btc::deposit_split(0, fee_bps, publisher_bps));
        let terms = FeeTerms {
            fee_bps,
            publisher_bps,
        };
        let row = if DepositFeesTable::read().get_index_pk().get(&()).is_some() {
            DepositFees {
                current: deposit_fees(now()),
                pending: Some(terms),
                activates_at: plus(now(), 86400),
            }
        } else {
            DepositFees {
                current: terms,
                pending: None,
                activates_at: 0,
            }
        };
        DepositFeesTable::read_write().put(&row).unwrap();
    }
    #[action]
    fn deposit(raw: String, block: String, siblings: Vec<String>, position: u32, vout: u32) {
        let mut c = live();
        tidy();
        let p = policy(&c);
        let (tx, h) = proof(&raw, &block, &siblings, position);
        // A deposit is proven within the window, counted in blocks under the relay's tip. Guard
        // records are retired by the same measure, so a late proof can never find its record gone.
        assert!(
            btc::deposit_in_window(btcrelay::Wrapper::call().getState().height, h.height),
            "Deposit proof is older than the 432-block (72 hour) window"
        );
        let txid = tx.compute_txid().to_string();
        let id = outpoint(&txid, vout);
        assert!(
            UtxoTable::read().get_index_pk().get(&id).is_none(),
            "Bitcoin output already processed"
        );
        assert!(
            TxTable::read().get_index_pk().get(&txid).is_none(),
            "Bridge transaction is not a new deposit"
        );
        assert!(tx.input.len() <= 256, "Deposit input limit");
        for input in &tx.input {
            assert!(
                UtxoTable::read()
                    .get_index_pk()
                    .get(&outpoint(
                        &input.previous_output.txid.to_string(),
                        input.previous_output.vout
                    ))
                    .is_none(),
                "Bridge-originated transaction cannot mint a deposit"
            );
        }
        let output = tx.output.get(vout as usize).expect("Deposit output index");
        let script = btc::hex::encode(output.script_pubkey.as_bytes());
        let binding = ScriptTable::read()
            .get_index_pk()
            .get(&script)
            .expect("Unregistered deposit address");
        assert_eq!(binding.branch, 0, "Change is not a deposit");
        let value = output.value.to_sat();
        assert!(
            value >= p.min_deposit && value <= btc::bitcoin::Amount::MAX_MONEY.to_sat(),
            "Deposit amount limit"
        );
        c.reserve = plus(c.reserve, value);
        c.liability = plus(c.liability, value);
        assert!(
            c.reserve <= btc::bitcoin::Amount::MAX_MONEY.to_sat(),
            "Bitcoin money supply limit"
        );
        UtxoTable::read_write()
            .put(&Utxo {
                id: id.clone(),
                txid: txid.clone(),
                vout,
                value,
                branch: 0,
                index: binding.index,
                height: h.height,
                block: block.clone(),
                status: 0,
                batch: 0,
            })
            .unwrap();
        Tokens::call().mint(c.token, value.into(), "Proven Bitcoin deposit".into());
        let fees = deposit_fees(now());
        let (net, treasury_fee, bounty) =
            must(btc::deposit_split(value, fees.fee_bps, fees.publisher_bps));
        let publisher = get_sender();
        credit(
            c.token,
            binding.owner,
            net,
            "Proven Bitcoin deposit, net of deposit fee",
        );
        credit(
            c.token,
            c.treasury,
            treasury_fee,
            "Bitcoin deposit service fee",
        );
        credit(
            c.token,
            publisher,
            bounty,
            "First valid Bitcoin deposit proof bounty",
        );
        emit_deposit(&Deposit {
                id,
                txid,
                vout,
                owner: binding.owner,
                address_index: binding.index,
                value,
                credited: net,
                fee: value - net,
                bounty,
                publisher: Some(publisher),
                fee_bps: fees.fee_bps,
                publisher_bps: fees.publisher_bps,
                height: h.height,
                block: block.clone(),
                credited_at: now(),
                legacy: false,
        });
        btcrelay::Wrapper::call().protect(block);
        save(&c);
    }
    #[action]
    fn withdraw(address: String, amount: u64, max_fee: u64) -> u64 {
        let mut c = live();
        tidy();
        let p = policy(&c);
        let owner = get_sender();
        assert!(
            amount >= p.min_withdrawal && amount <= btc::bitcoin::Amount::MAX_MONEY.to_sat(),
            "Withdrawal amount limit"
        );
        assert!(
            max_fee > 0 && max_fee <= 10_000_000,
            "Withdrawal fee cap limit"
        );
        let destination = must(btc::destination(&p, &address));
        let script = btc::hex::encode(destination.as_bytes());
        assert!(
            ScriptTable::read().get_index_pk().get(&script).is_none(),
            "Withdraw to an external Bitcoin address"
        );
        // Accepted only if a batch of this request alone, made now from the available confirmed
        // outputs, would pay it within its fee allowance. Otherwise refused with the figure
        // that works: the amount and all fees are settled before anything is set aside.
        let candidates: Vec<_> = UtxoTable::read()
            .get_index_by_status()
            .range((0, 0, String::new())..=(0, u32::MAX, "z".into()))
            .take(256)
            .map(|u| u.input())
            .collect();
        if let Err(refusal) = must(btc::admit_withdrawal(&p, &candidates, &script, amount, max_fee)) {
            abort_message(&refusal.to_string());
        }
        let locked = plus(plus(amount, max_fee), p.service_fee);
        Tokens::call().debit(
            c.token,
            owner,
            locked.into(),
            "Bitcoin withdrawal authorization".into(),
        );
        Tokens::call().toSub(c.token, "withdrawals".into(), locked.into());
        c.escrow = plus(c.escrow, locked);
        let id = c.next_request;
        c.next_request = c
            .next_request
            .checked_add(1)
            .expect("Request IDs exhausted");
        RequestTable::read_write()
            .put(&Withdrawal {
                id,
                owner,
                address,
                script,
                amount,
                max_fee,
                service_fee: p.service_fee,
                created: now(),
                status: 0,
                batch: 0,
                paid_fee: 0,
                txid: String::new(),
            })
            .unwrap();
        save(&c);
        id
    }
    #[action]
    fn cancel(request: u64) {
        // Cancellation before commitment remains available if relay data is stale or paused.
        let mut c = config();
        audit(&c);
        tidy();
        let r = RequestTable::read()
            .get_index_pk()
            .get(&request)
            .expect("Unknown request");
        assert_eq!(r.owner, get_sender(), "Withdrawal owner authority");
        assert!(
            r.status == 0 || r.status == 4 || r.status == 5,
            "Committed withdrawals cannot be cancelled"
        );
        let locked = plus(plus(r.amount, r.max_fee), r.service_fee);
        c.escrow -= locked;
        Tokens::call().fromSub(c.token, "withdrawals".into(), locked.into());
        credit(c.token, r.owner, locked, "Cancelled Bitcoin withdrawal");
        // The row is erased as stored, so that its index entries go with it.
        retire(&r, "cancelled", r.status);
        save(&c);
    }
    /// Registers the indexes of this service's events. `init` does it for a new bridge; a bridge
    /// initialized before it emitted events calls this once, under its own authority.
    #[action]
    fn indexEvents() {
        assert_eq!(get_sender(), Wrapper::SERVICE, "Bridge administration authority");
        index_events();
    }
    /// A withdrawal request that left objective state. `reason` is "cancelled"; `prior_status` is
    /// the state it was in (0 queued, 4 fee allowance too low, 5 waiting for the reserve; 3 for a
    /// row cancelled before this event existed). `batch`, `paid_fee` and `txid` are empty for a
    /// cancelled request.
    #[event(history)]
    pub fn depositCredited(
        id: String,
        txid: String,
        vout: u32,
        owner: AccountNumber,
        address_index: u32,
        value: u64,
        credited: u64,
        fee: u64,
        bounty: u64,
        publisher: String,
        fee_bps: u16,
        publisher_bps: u16,
        height: u32,
        block: String,
        credited_at: u64,
        legacy: bool,
    ) {
    }
    /// A withdrawal request that left objective state. See `retire`.
    #[event(history)]
    pub fn withdrawalRetired(
        id: u64,
        owner: AccountNumber,
        address: String,
        amount: u64,
        max_fee: u64,
        service_fee: u64,
        created: u64,
        retired: u64,
        reason: String,
        prior_status: u8,
        batch: u32,
        paid_fee: u64,
        txid: String,
    ) {
    }
    #[action]
    fn makeBatch() -> u32 {
        let mut c = live();
        tidy();
        let p = policy(&c);
        assert!(
            BatchTable::read()
                .get_index_by_status()
                .range((0, 0)..=(0, u32::MAX))
                .take(16)
                .count()
                < 16,
            "Open batch limit"
        );
        let candidates: Vec<_> = UtxoTable::read()
            .get_index_by_status()
            .range((0, 0, String::new())..=(0, u32::MAX, "z".into()))
            .take(256)
            .map(|u| u.input())
            .collect();
        let id = c.next_batch;
        // Requests waiting for the reserve (status 5) rejoin the queue, in their old place, once
        // the available outputs can pay them. A bounded number is looked at per call.
        let waiting: Vec<_> = RequestTable::read()
            .get_index_by_status()
            .range((5, 0)..=(5, u64::MAX))
            .take(32)
            .collect();
        for mut r in waiting {
            if must(btc::fundable_alone(&p, id, &candidates, &r.payment())) {
                r.status = 0;
                RequestTable::read_write().put(&r).unwrap();
            }
        }
        let mut requests: Vec<_> = RequestTable::read()
            .get_index_by_status()
            .range((0, 0)..=(0, u64::MAX))
            .take(p.batch_size as usize)
            .collect();
        assert!(!requests.is_empty(), "No pending withdrawals");
        assert!(
            requests.len() >= p.batch_size as usize
                || now() >= requests[0].created + p.batch_seconds as u64,
            "Withdrawal batch is not due"
        );
        // No single request can make this call fail: one the reserve cannot pay waits for the
        // reserve (5), one whose fee allowance is too small is set aside (4), and the batch is
        // made from the others. Both are persisted even when no batch results.
        let payments: Vec<_> = requests.iter().map(|r| r.payment()).collect();
        let choice = must(btc::choose_batch(&p, id, &candidates, &payments));
        for r in &mut requests {
            if choice.unfunded.contains(&r.id) {
                r.status = 5;
            } else if choice.over_fee_cap.contains(&r.id) {
                r.status = 4;
            } else {
                continue;
            }
            RequestTable::read_write().put(r).unwrap();
        }
        let paid: Vec<u64> = choice
            .plan
            .iter()
            .flat_map(|plan| plan.payments.iter().map(|r| r.id))
            .collect();
        // Requests neither set aside nor paid stay queued for the next batch.
        requests.retain(|r| paid.contains(&r.id));
        let plan = match choice.plan {
            Some(plan)
                if requests.len() >= p.batch_size as usize
                    || now() >= requests[0].created + p.batch_seconds as u64 =>
            {
                plan
            }
            _ => {
                save(&c);
                return 0;
            }
        };
        for input in &plan.inputs {
            let mut u = UtxoTable::read().get_index_pk().get(&input.id()).unwrap();
            assert_eq!(u.status, 0, "UTXO already reserved");
            u.status = 1;
            u.batch = id;
            UtxoTable::read_write().put(&u).unwrap();
        }
        for mut r in requests.clone() {
            r.status = 1;
            r.batch = id;
            RequestTable::read_write().put(&r).unwrap();
        }
        BatchTable::read_write()
            .put(&Batch {
                id,
                status: 0,
                created: now(),
                current_revision: 0,
                requests: requests.iter().map(|r| r.id).collect(),
                txid: String::new(),
            })
            .unwrap();
        store_revision(&c, id, 0, &plan, &p);
        c.next_batch = c.next_batch.checked_add(1).expect("Batch IDs exhausted");
        save(&c);
        id
    }
    #[action]
    fn bump(batch: u32, fee_rate: u64) {
        let c = live();
        let mut b = BatchTable::read()
            .get_index_pk()
            .get(&batch)
            .expect("Unknown batch");
        assert_eq!(b.status, 0, "Batch already completed");
        assert!(b.current_revision < 8, "Fee revision limit");
        let old = revision(batch, b.current_revision);
        assert!(
            now() >= old.created + 300,
            "Wait five minutes before replacing fees"
        );
        let mut p = policy(&c);
        let old_policy: btc::Policy = serde_json::from_str(&old.policy).unwrap();
        assert!(
            fee_rate > old_policy.fee_rate && fee_rate <= p.max_fee_rate,
            "Replacement fee rate limit"
        );
        p.fee_rate = fee_rate;
        let previous: btc::Plan = serde_json::from_str(&old.plan).unwrap();
        let plan = must(btc::build_plan(
            &p,
            batch,
            &previous.inputs,
            &previous.payments,
        ));
        assert_eq!(
            plan.inputs, previous.inputs,
            "Replacement must retain every input"
        );
        // Minimum incremental relay fee: conservatively at least one sat/vbyte of the old template.
        let tx: btc::bitcoin::Transaction = must(btc::decode(&previous.unsigned, 100000));
        assert!(
            plan.fee >= previous.fee + tx.vsize() as u64,
            "Insufficient replacement fee increment"
        );
        b.current_revision += 1;
        store_revision(&c, batch, b.current_revision, &plan, &p);
        BatchTable::read_write().put(&b).unwrap();
    }
    fn sign(batch: u32, rev: u32, signer: u8, signatures: Vec<String>) {
        let _c = live();
        let b = BatchTable::read()
            .get_index_pk()
            .get(&batch)
            .expect("Unknown batch");
        assert_eq!(b.status, 0, "Batch already completed");
        assert_eq!(rev, b.current_revision, "Superseded revision");
        let mut r = revision(batch, rev);
        let current = psibase::services::transact::Wrapper::call().currentBlock();
        assert!(
            current.commitNum >= r.authorized_block,
            "Batch authorization is not irreversible"
        );
        let p: btc::Policy = serde_json::from_str(&r.policy).unwrap();
        let plan: btc::Plan = serde_json::from_str(&r.plan).unwrap();
        must(btc::verify_signatures(&p, &plan, signer, &signatures));
        assert!(
            SignatureTable::read()
                .get_index_pk()
                .get(&(batch, rev, signer))
                .is_none(),
            "Signer already submitted"
        );
        SignatureTable::read_write()
            .put(&SignerResponse {
                batch,
                revision: rev,
                signer,
                signatures,
            })
            .unwrap();
        let responses: Vec<_> = SignatureTable::read()
            .get_index_pk()
            .range((batch, rev, 0)..=(batch, rev, 2))
            .map(|s| (s.signer, s.signatures))
            .collect();
        if responses.len() >= 2 && r.raw.is_empty() {
            r.raw = must(btc::finalize(&p, &plan, &responses));
            RevisionTable::read_write().put(&r).unwrap();
        }
    }
    #[action]
    fn requestSigs(batch: u32, rev: u32, signer: u8, max_requests: u32) {
        live();
        assert!(
            signer < 3 && (1..=16).contains(&max_requests),
            "Signing request work limit"
        );
        let b = BatchTable::read()
            .get_index_pk()
            .get(&batch)
            .expect("Unknown batch");
        assert_eq!(
            (b.status, b.current_revision),
            (0, rev),
            "Batch is complete or revision superseded"
        );
        let r = revision(batch, rev);
        let p: btc::Policy = serde_json::from_str(&r.policy).unwrap();
        let plan: btc::Plan = serde_json::from_str(&r.plan).unwrap();
        must(btc::check_plan(&p, &plan));
        let custody = CustodyKeyTable::read().get_index_pk().get(&signer).unwrap();
        let mut count = 0;
        for (n, input) in plan.inputs.iter().enumerate() {
            if SigningLinkTable::read()
                .get_index_pk()
                .get(&(batch, rev, signer, n as u32))
                .is_some()
            {
                continue;
            }
            let digest = must(btc::sighash(&p, &plan, n));
            let request = signing::Wrapper::call().requestHash(
                custody.key,
                vec![input.branch, input.index],
                btc::hex::encode(digest.as_ref()),
            );
            SigningLinkTable::read_write()
                .put(&SigningLink {
                    batch,
                    revision: rev,
                    signer,
                    input: n as u32,
                    request,
                })
                .unwrap();
            count += 1;
            if count >= max_requests {
                break;
            }
        }
    }
    #[action]
    fn gather(batch: u32, rev: u32, signer: u8) {
        assert!(signer < 3, "Signer index");
        let r = revision(batch, rev);
        let plan: btc::Plan = serde_json::from_str(&r.plan).unwrap();
        let mut signatures = vec![];
        let custody = CustodyKeyTable::read().get_index_pk().get(&signer).unwrap();
        for (n, input) in plan.inputs.iter().enumerate() {
            let link = SigningLinkTable::read()
                .get_index_pk()
                .get(&(batch, rev, signer, n as u32))
                .expect("Hash request not created");
            let response = signing::Wrapper::call().getRequest(link.request);
            assert_eq!(response.key, custody.key, "Signature key mismatch");
            assert_eq!(
                response.path,
                vec![input.branch, input.index],
                "Signature derivation mismatch"
            );
            let sig = btc::bitcoin::secp256k1::ecdsa::Signature::from_compact(&must(
                btc::hex::decode(&response.signature).map_err(|e| e.to_string()),
            ))
            .expect("Signature not ready");
            let mut bytes = sig.serialize_der().to_vec();
            bytes.push(1);
            signatures.push(btc::hex::encode(bytes));
        }
        sign(batch, rev, signer, signatures);
    }
    #[action]
    fn complete(raw: String, block: String, siblings: Vec<String>, position: u32) {
        let mut c = live();
        tidy();
        let (tx, h) = proof(&raw, &block, &siblings, position);
        let txid = tx.compute_txid().to_string();
        let reference = TxTable::read()
            .get_index_pk()
            .get(&txid)
            .expect("Not an authorized bridge transaction");
        let mut b = BatchTable::read()
            .get_index_pk()
            .get(&reference.batch)
            .unwrap();
        assert_eq!(b.status, 0, "Batch already completed");
        let r = revision(b.id, reference.revision);
        let plan: btc::Plan = serde_json::from_str(&r.plan).unwrap();
        assert_eq!(txid, plan.txid, "Wrong withdrawal transaction");
        let p: btc::Policy = serde_json::from_str(&r.policy).unwrap();
        must(btc::check_plan(&p, &plan));
        for input in &plan.inputs {
            let mut u = UtxoTable::read().get_index_pk().get(&input.id()).unwrap();
            assert_eq!((u.status, u.batch), (1, b.id), "Reserved UTXO mismatch");
            u.status = 2;
            UtxoTable::read_write().put(&u).unwrap();
        }
        let index = plan.payments.len() as u32;
        UtxoTable::read_write()
            .put(&Utxo {
                id: outpoint(&txid, index),
                txid: txid.clone(),
                vout: index,
                value: plan.change,
                branch: 1,
                index: b.id,
                height: h.height,
                block: block.clone(),
                status: 0,
                batch: 0,
            })
            .unwrap();
        let mut burned = 0;
        for (payment, fee) in plan.payments.iter().zip(&plan.fees) {
            let mut w = RequestTable::read()
                .get_index_pk()
                .get(&payment.id)
                .unwrap();
            assert_eq!(
                (w.status, w.batch),
                (1, b.id),
                "Withdrawal reservation mismatch"
            );
            let locked = plus(plus(w.amount, w.max_fee), w.service_fee);
            c.escrow -= locked;
            Tokens::call().fromSub(c.token, "withdrawals".into(), locked.into());
            let burn = plus(w.amount, *fee);
            Tokens::call().burn(
                c.token,
                burn.into(),
                "Confirmed Bitcoin withdrawal and miner fee".into(),
            );
            burned = plus(burned, burn);
            credit(
                c.token,
                w.owner,
                w.max_fee - *fee,
                "Unused Bitcoin network fee allowance",
            );
            credit(
                c.token,
                c.treasury,
                w.service_fee,
                "Bitcoin bridge service fee",
            );
            w.status = 2;
            w.txid = txid.clone();
            w.paid_fee = *fee;
            RequestTable::read_write().put(&w).unwrap();
        }
        c.reserve -= burned;
        c.liability -= burned;
        b.status = 1;
        b.txid = txid;
        BatchTable::read_write().put(&b).unwrap();
        btcrelay::Wrapper::call().protect(block);
        save(&c);
    }
    #[action]
    fn reportSpend(raw: String, block: String, siblings: Vec<String>, position: u32) {
        let mut c = live();
        let (tx, _h) = proof(&raw, &block, &siblings, position);
        assert!(
            TxTable::read()
                .get_index_pk()
                .get(&tx.compute_txid().to_string())
                .is_none(),
            "Use complete for an authorized batch"
        );
        assert!(tx.input.len() <= 256, "Spend report input limit");
        let mut found = false;
        for input in &tx.input {
            if UtxoTable::read()
                .get_index_pk()
                .get(&outpoint(
                    &input.previous_output.txid.to_string(),
                    input.previous_output.vout,
                ))
                .is_some()
            {
                found = true;
            }
        }
        assert!(found, "Transaction spends no tracked bridge output");
        c.paused = true;
        c.reason = format!("Unexpected Bitcoin spend {}", tx.compute_txid());
        ConfigTable::read_write().put(&c).unwrap();
        btcrelay::Wrapper::call().protect(block);
    }
}
