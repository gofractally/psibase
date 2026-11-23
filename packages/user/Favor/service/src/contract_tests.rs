//! Fresh-chain contract tests. No running node, UI, plugins, or demo identities.
use super::*;

use psibase::*;
use serde_json::{json, Value};

const A: AccountNumber = account!("alice");
const B: AccountNumber = account!("bob");
const C: AccountNumber = account!("carol");
const D: AccountNumber = account!("dan");
const Q: AccountNumber = account!("favor+1");

struct Fixture {
    chain: Chain,
}
#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct Preview {
    payee: AccountNumber,
    symbol: String,
    amount: String,
    total: String,
    fee: String,
    reference: String,
    encoded_route: String,
}
impl Preview {
    fn action(&self, payer: AccountNumber) -> Action {
        Wrapper::pack_from(payer).pay(
            self.payee,
            self.symbol.clone(),
            self.amount.clone(),
            self.total.clone(),
            self.encoded_route.clone(),
            self.reference.clone(),
            "private coffee note".into(),
        )
    }
}
impl Fixture {
    fn new() -> Self {
        Self::with_key(true)
    }
    fn with_key(provision: bool) -> Self {
        let chain = Chain::test_chain();
        chain
            .deploy_service(Wrapper::SERVICE, include_bytes!(env!("FAVOR_TEST_SERVICE")))
            .unwrap();
        // A subaccount is created by its primary account, matching production
        // account-name policy rather than bypassing it through the tester.
        services::accounts::Wrapper::push_from(&chain, Wrapper::SERVICE)
            .newAccount(
                Q,
                services::auth_any::SERVICE,
                services::accounts::NewAccountMode::RequireNew,
            )
            .get()
            .unwrap();
        services::setcode::Wrapper::push_from(&chain, Q)
            .setCode(
                Q,
                0,
                0,
                include_bytes!(env!("FAVOR_TEST_QUERY_SERVICE"))
                    .to_vec()
                    .into(),
            )
            .get()
            .unwrap();
        services::http_server::Wrapper::push_from(&chain, Wrapper::SERVICE)
            .registerServer(Q)
            .get()
            .unwrap();
        for user in [A, B, C, D] {
            chain.new_account(user).unwrap();
        }
        if provision {
            Wrapper::push(&chain)
                .rotate_key(vec![42; 32].into())
                .get()
                .unwrap();
        }
        Self { chain }
    }
    fn line(
        &self,
        creditor: AccountNumber,
        debtor: AccountNumber,
        amount: &str,
        fee: u32,
        forwarding: bool,
    ) {
        Wrapper::push_from(&self.chain, creditor)
            .set_line(debtor, "USD".into(), amount.into(), fee, forwarding)
            .get()
            .unwrap();
    }
    fn query(&self, user: Option<AccountNumber>, query: &str) -> Value {
        let token = user
            .map(|u| self.chain.login(u, Wrapper::SERVICE).unwrap())
            .unwrap_or_default();
        self.chain
            .graphql_auth(Wrapper::SERVICE, query, &token)
            .unwrap()
    }
    fn preview_result(
        &self,
        payer: AccountNumber,
        payee: AccountNumber,
        symbol: &str,
        amount: &str,
        reference: &str,
        secret: Option<&str>,
    ) -> Value {
        let secret = secret
            .map(|s| format!(",requestSecret:{}", json!(s)))
            .unwrap_or_default();
        self.query(Some(payer), &format!("{{quote(payee:{},symbol:{},amount:{},reference:{}{}){{payee symbol amount total fee reference encodedRoute}}}}", json!(payee), json!(symbol), json!(amount), json!(reference), secret))
    }
    fn preview(
        &self,
        payer: AccountNumber,
        payee: AccountNumber,
        amount: &str,
        reference: &str,
        secret: Option<&str>,
    ) -> Preview {
        let result = self.preview_result(payer, payee, "USD", amount, reference, secret);
        assert!(result.get("errors").is_none(), "{result}");
        serde_json::from_value(result["data"]["quote"].clone()).unwrap()
    }
    fn signed_transaction(&self, actions: Vec<Action>) -> SignedTransaction {
        // Different TAPOS prevents the platform's duplicate-transaction check from
        // masking the contract's own idempotency/reference rejection.
        self.chain.start_block();
        self.pack_transaction(actions)
    }
    fn pack_transaction(&self, actions: Vec<Action>) -> SignedTransaction {
        let mut tx = Transaction {
            tapos: Default::default(),
            actions,
            claims: vec![],
        };
        self.chain.fill_tapos(&mut tx, 10);
        SignedTransaction {
            transaction: psio::pssz::Nested::new(&tx).unwrap(),
            proofs: vec![],
            subjectiveData: None,
        }
    }
    fn push(&self, actions: Vec<Action>) -> TransactionTrace {
        let trace = self.chain.push(&self.pack_transaction(actions));
        // HTTP queries read the committed head, so finish the transaction's
        // block just as ChainPusher does before comparing query results.
        self.chain.start_block();
        trace
    }
    fn ok(&self, actions: Vec<Action>) {
        self.push(actions).ok().unwrap();
    }
    fn snapshot(&self) -> Vec<Vec<Vec<u8>>> {
        macro_rules! rows {
            ($record:ty, $table:ty) => {
                self.chain
                    .open::<$record, $table>()
                    .get_index_pk()
                    .iter()
                    .map(|r| psio::to_pssz(&r))
                    .collect()
            };
        }
        vec![
            rows!(Line, Lines),
            rows!(Receipt, Receipts),
            rows!(Counter, Counters),
            rows!(Payment, Payments),
            rows!(RouteKey, RouteKeys),
            rows!(Preference, Preferences),
            rows!(Request, Requests),
        ]
    }
    #[track_caller]
    fn reject(&self, actions: Vec<Action>, expected: &str) {
        let before = self.snapshot();
        let target = actions.last().unwrap().clone();
        let trace = self.push(actions);
        assert!(
            trace.error_text().as_deref().is_some_and(|e| e.contains(expected)),
            "expected {expected:?}; got {:?}",
            trace.error
        );
        fn failed_at(t: &ActionTrace, target: &Action, expected: &str) -> bool {
            (t.action.service == target.service
                && t.action.method == target.method
                && t.error_text().as_deref().is_some_and(|e| e.contains(expected)))
                || t.inner_traces.iter().any(|t| match &t.inner {
                    InnerTraceEnum::ActionTrace(t) => failed_at(t, target, expected),
                    _ => false,
                })
        }
        assert!(
            trace
                .action_traces
                .iter()
                .any(|t| failed_at(t, &target, expected)),
            "expected the specified action to reject, not an unrelated infrastructure failure"
        );
        assert!(
            before == self.snapshot(),
            "rejected transaction changed Favor tables"
        );
    }
    fn row(&self, a: AccountNumber, b: AccountNumber, symbol: &str) -> Line {
        self.chain
            .open::<Line, Lines>()
            .get_index_by_pair()
            .get(&pair_key(symbol, a, b))
            .unwrap()
    }
    fn owed(&self, creditor: AccountNumber, debtor: AccountNumber) -> i64 {
        let l = self.row(creditor, debtor, "USD");
        if creditor == l.low {
            l.balance
        } else {
            -l.balance
        }
    }
    fn time(&self) -> i64 {
        self.query(Some(A), "{settings{serverTime}}")["data"]["settings"]["serverTime"]
            .as_str()
            .unwrap()
            .parse()
            .unwrap()
    }
    fn request(
        &self,
        owner: AccountNumber,
        n: u8,
        amount: &str,
        payer: Option<AccountNumber>,
        duration: i64,
    ) -> String {
        let secret = crypto::hex(&[n; 32]);
        self.ok(vec![Wrapper::pack_from(owner).create_request(
            crypto::hash_secret(&secret).unwrap(),
            "USD".into(),
            amount.into(),
            self.time() + duration,
            payer,
        )]);
        secret
    }
    fn network(&self) {
        self.line(B, A, "100", 0, true);
        self.line(C, B, "100", 0, true);
        self.line(B, C, "0", 10_000, true);
    }
    #[track_caller]
    fn unavailable(
        &self,
        payer: AccountNumber,
        payee: AccountNumber,
        symbol: &str,
        amount: &str,
        reference: &str,
        secret: Option<&str>,
    ) {
        let before = self.snapshot();
        let result = self.preview_result(payer, payee, symbol, amount, reference, secret);
        assert_eq!(result["errors"][0]["message"], INVALID, "{result}");
        assert!(before == self.snapshot(), "query changed objective state");
    }
}

#[test]
fn smoke_deployed_contract_and_authenticated_query() {
    let f = Fixture::new();
    f.line(B, A, "100", 0, true);
    let result = f.query(
        Some(A),
        "{lines{nodes{peer symbol theyExtend}} settings{routingReady}}",
    );
    assert_eq!(result["data"]["lines"]["nodes"][0]["peer"], "bob");
    assert_eq!(result["data"]["settings"]["routingReady"], true);
}

#[test]
fn missing_routing_key_fails_closed_until_owner_provisions_it() {
    let f = Fixture::with_key(false);
    let g = Fixture::new();
    f.line(B, A, "100", 0, true);
    g.line(B, A, "100", 0, true);
    assert_eq!(
        f.query(Some(A), "{settings{routingReady}}")["data"]["settings"]["routingReady"],
        false
    );
    f.unavailable(A, B, "USD", "1", "unkeyed-001", None);
    let q = g.preview(A, B, "1", "unkeyed-001", None);
    f.reject(vec![q.action(A)], INVALID);
    f.ok(vec![Wrapper::pack().rotate_key(vec![42; 32].into())]);
    let q = f.preview(A, B, "1", "key-ready-01", None);
    f.ok(vec![q.action(A)]);
}

#[test]
fn authenticated_invalid_routes_cannot_bypass_objective_validation() {
    let f = Fixture::new();
    f.network();
    f.line(D, C, "100", 0, true);
    let q = f.preview(A, C, "1", "bad-hop-0001", None);
    let e = Envelope::parse(&q.encoded_route).unwrap();
    let first = e.open(&[42; 32], &A.to_string(), 0).unwrap();
    let second = e.open(&[42; 32], &B.to_string(), 1).unwrap();
    let hops = vec![
        (A.to_string(), first.clone()),
        (B.to_string(), second.clone()),
    ];
    let mut variants = Vec::new();
    for slot in 0..2 {
        for field in [
            "missing",
            "revision",
            "zero",
            "oversized",
            "wrong-amount",
            "end",
        ] {
            let mut bad = hops.clone();
            match field {
                "missing" => bad[slot].1.line = 999,
                "revision" => bad[slot].1.revision += 1,
                "zero" => bad[slot].1.amount = 0,
                "oversized" => bad[slot].1.amount = routing::MAX_AMOUNT + 1,
                "wrong-amount" => bad[slot].1.amount += 1,
                "end" => bad[slot].1.end = !bad[slot].1.end,
                _ => unreachable!(),
            }
            variants.push((e.context.clone(), bad));
        }
    }
    let mut bad = hops.clone();
    bad[0].1.line = f.row(C, D, "USD").id;
    variants.push((e.context.clone(), bad));
    let mut bad = hops.clone();
    bad[1].1.line = first.line;
    variants.push((e.context.clone(), bad)); // cycle to payer
    for field in ["zero", "total", "future"] {
        let mut c = e.context.clone();
        match field {
            "zero" => c.amount = 0,
            "total" => c.total = c.amount - 1,
            "future" => c.expires_at = f.time() + 600,
            _ => unreachable!(),
        };
        variants.push((c, hops.clone()));
    }
    for (context, hops) in variants {
        let mut bad = q.clone();
        bad.amount = routing::decimal(context.amount);
        bad.total = routing::decimal(context.total);
        bad.encoded_route = Envelope::seal(&[42; 32], context, &hops, &[31; 360]).unwrap();
        f.reject(vec![bad.action(A)], INVALID);
    }
    f.ok(vec![q.action(A)]);
}

#[test]
fn line_settings_are_bilateral_isolated_and_validate_inputs() {
    let f = Fixture::new();
    let set =
        |p, s: &str, a: &str, fee| Wrapper::pack_from(A).set_line(p, s.into(), a.into(), fee, true);
    f.reject(
        vec![set(A, "USD", "1", 0)],
        "Choose someone other than yourself",
    );
    f.reject(
        vec![set(account!("nobody"), "USD", "1", 0)],
        "Account does not exist",
    );
    for s in ["U", "usd", "USD1", "ABCDEFGHIJKLM", "ÜSD"] {
        f.reject(
            vec![set(B, s, "1", 0)],
            "Use a symbol of 2–12 uppercase letters",
        );
    }
    for a in ["-1", "1.000000001", "1e2", "NaN", "1.", ".1", ""] {
        f.reject(vec![set(B, "USD", a, 0)], "Use a nonnegative amount");
    }
    for a in [
        "90000000.00000001",
        "18446744073709551616",
        "18446744073709551615",
    ] {
        f.reject(vec![set(B, "USD", a, 0)], "Amount too large");
    }
    f.reject(
        vec![set(B, "USD", "1", 1_000_001)],
        "Routing fee cannot exceed 100%",
    );
    f.line(A, B, "10", 12_345, false);
    f.line(B, A, "20", 54_321, true);
    let l = f.row(A, B, "USD");
    assert_eq!(l.revision, 2);
    let (a_limit, b_limit, a_fee, b_fee, a_forward) = if l.low == A {
        (
            l.low_limit,
            l.high_limit,
            l.low_fee,
            l.high_fee,
            l.low_forward,
        )
    } else {
        (
            l.high_limit,
            l.low_limit,
            l.high_fee,
            l.low_fee,
            l.high_forward,
        )
    };
    assert_eq!(
        (a_limit, b_limit, a_fee, b_fee, a_forward),
        (
            10 * routing::SCALE,
            20 * routing::SCALE,
            12_345,
            54_321,
            false
        )
    );
    f.ok(vec![set(B, "BTC", "90000000", 1_000_000)]);
    assert_eq!(f.row(A, B, "BTC").balance, 0);
    assert_eq!(f.row(A, B, "USD").revision, 2);
    f.ok(vec![
        set(B, "AB", "0", 0),
        set(B, "ABCDEFGHIJKL", "0.00000001", 0),
    ]);
}

#[test]
fn direct_mutual_payments_cross_zero_and_reduced_limits_preserve_debt() {
    let f = Fixture::new();
    f.line(B, A, "10", 0, false);
    let q = f.preview(A, B, "10", "direct-0001", None);
    f.ok(vec![q.action(A)]);
    assert_eq!(f.owed(B, A), 10 * routing::SCALE as i64);
    f.unavailable(A, B, "USD", "0.00000001", "no-capacity", None);
    f.line(B, A, "0", 0, false);
    assert_eq!(f.owed(B, A), 10 * routing::SCALE as i64);
    let q = f.preview(B, A, "4", "reverse-001", None);
    f.ok(vec![q.action(B)]);
    assert_eq!(f.owed(B, A), 6 * routing::SCALE as i64);
    f.line(A, B, "20", 0, false);
    let q = f.preview(B, A, "8", "cross-zero-1", None);
    f.ok(vec![q.action(B)]);
    assert_eq!(f.owed(A, B), 2 * routing::SCALE as i64);
    // A may pay back existing debt despite B granting no additional credit.
    let q = f.preview(A, B, "2", "zero-again-1", None);
    f.ok(vec![q.action(A)]);
    assert_eq!(f.owed(A, B), 0);
    f.unavailable(A, B, "BTC", "1", "other-symbol", None);
}

#[test]
fn multihop_fees_receipts_and_shared_reference_replay_checks() {
    let f = Fixture::new();
    f.network();
    let before = f.snapshot();
    let q = f.preview(A, C, "20", "multi-hop-01", None);
    assert!(before == f.snapshot(), "preview writes objective state");
    assert_eq!((q.total.as_str(), q.fee.as_str()), ("20.2", "0.2"));
    let envelope: Value = serde_json::from_str(&q.encoded_route).unwrap();
    assert_eq!(envelope["layers"].as_array().unwrap().len(), 7);
    assert!(!q.encoded_route.contains("bob"));
    f.ok(vec![q.action(A)]);
    assert_eq!(f.owed(B, A), 2_020_000_000);
    assert_eq!(f.owed(C, B), 2_000_000_000);
    let rows: Vec<_> = f
        .chain
        .open::<Receipt, Receipts>()
        .get_index_pk()
        .iter()
        .collect();
    assert_eq!(rows.len(), 3);
    let r = rows.iter().find(|r| r.owner == B).unwrap();
    assert_eq!(
        (
            r.kind.as_str(),
            r.incoming,
            r.outgoing,
            r.received - r.sent,
            r.memo.as_str()
        ),
        ("routed", Some(A), Some(C), 20_000_000, "")
    );
    for user in [A, C] {
        assert_eq!(
            rows.iter().find(|r| r.owner == user).unwrap().memo,
            "private coffee note"
        );
    }
    f.reject(
        vec![q.action(A)],
        "This payment reference has already been used",
    );
    // settle and pay share the sender's nonce namespace.
    f.reject(
        vec![Wrapper::pack_from(A).settle(B, "USD".into(), "1".into(), q.reference.clone())],
        "This payment reference has already been used",
    );
    f.ok(vec![Wrapper::pack_from(C).settle(
        B,
        "USD".into(),
        "1".into(),
        q.reference.clone(),
    )]);
}

#[test]
fn tampered_context_ciphertext_and_action_substitutions_are_atomic() {
    let f = Fixture::new();
    f.network();
    let q = f.preview(A, C, "1", "tamper-0001", None);
    let mut variants = Vec::new();
    for field in [
        "epoch",
        "payer",
        "payee",
        "symbol",
        "amount",
        "total",
        "expires_at",
        "reference",
        "request",
        "version",
    ] {
        let mut e: Value = serde_json::from_str(&q.encoded_route).unwrap();
        e["context"][field] = match field {
            "payer" => json!(D),
            "payee" => json!(B),
            "symbol" => json!("BTC"),
            "reference" => json!("different-ref"),
            "request" => json!("00".repeat(32)),
            _ => json!(999),
        };
        variants.push(e.to_string());
    }
    for field in ["nonce", "tag"] {
        let mut e: Value = serde_json::from_str(&q.encoded_route).unwrap();
        let s = e[field].as_str().unwrap();
        e[field] = json!(format!(
            "{}{}",
            if &s[..1] == "0" { "1" } else { "0" },
            &s[1..]
        ));
        variants.push(e.to_string());
    }
    for slot in 0..7 {
        let mut e: Value = serde_json::from_str(&q.encoded_route).unwrap();
        let s = e["layers"][slot].as_str().unwrap();
        e["layers"][slot] = json!(format!(
            "{}{}",
            if &s[..1] == "0" { "1" } else { "0" },
            &s[1..]
        ));
        variants.push(e.to_string());
    }
    variants.extend(["{}".into(), "not-json".into(), "x".repeat(4097)]);
    for encoded_route in variants {
        let mut bad = q.clone();
        bad.encoded_route = encoded_route;
        f.reject(vec![bad.action(A)], INVALID);
    }
    for bad in [
        Preview {
            payee: B,
            ..q.clone()
        },
        Preview {
            symbol: "BTC".into(),
            ..q.clone()
        },
        Preview {
            amount: "2".into(),
            ..q.clone()
        },
        Preview {
            total: "1".into(),
            ..q.clone()
        },
        Preview {
            reference: "changed-ref".into(),
            ..q.clone()
        },
    ] {
        f.reject(vec![bad.action(A)], INVALID);
    }
    f.reject(vec![q.action(D)], INVALID);
    f.reject(
        vec![Wrapper::pack_from(A).pay(
            C,
            "USD".into(),
            "1".into(),
            q.total.clone(),
            q.encoded_route.clone(),
            q.reference.clone(),
            "x".repeat(257),
        )],
        "Payment note is too long",
    );
    f.reject(
        vec![Wrapper::pack_from(A).pay(
            C,
            "USD".into(),
            "1".into(),
            q.total.clone(),
            q.encoded_route.clone(),
            "bad!".into(),
            "".into(),
        )],
        "Invalid payment reference",
    );
    f.ok(vec![q.action(A)]);
}

#[test]
fn key_rotation_expiry_and_capacity_changes_revalidate_at_execution() {
    let f = Fixture::new();
    f.network();
    f.reject(
        vec![Wrapper::pack_from(A).rotate_key(vec![1; 32].into())],
        "Only the service owner can rotate routing keys",
    );
    for len in [0, 31, 33] {
        f.reject(
            vec![Wrapper::pack().rotate_key(vec![1; len].into())],
            "A 256-bit routing key is required",
        );
    }
    let q = f.preview(A, C, "1", "key-old-001", None);
    f.ok(vec![Wrapper::pack().rotate_key(vec![43; 32].into())]);
    f.reject(vec![q.action(A)], INVALID);
    let q = f.preview(A, C, "1", "expired-001", None);
    f.chain.start_block_after(Seconds::from_ticks(61).into());
    f.reject(vec![q.action(A)], INVALID);
    let q = f.preview(A, C, "1", "revision-01", None);
    f.line(B, A, "99", 0, true);
    f.reject(vec![q.action(A)], INVALID);
    // A concurrent payment changes capacity but does not change settings/revision.
    let q = f.preview(A, C, "90", "capacity-01", None);
    let other = f.preview(A, B, "10", "concurrent-1", None);
    f.ok(vec![other.action(A)]);
    f.reject(vec![q.action(A)], INVALID);
}

#[test]
fn forwarding_pause_and_lowest_total_fee_with_alternative_paths() {
    let f = Fixture::new();
    f.network();
    f.line(D, A, "100", 0, true);
    f.line(C, D, "100", 0, true);
    f.line(D, C, "0", 5_000, true);
    let q = f.preview(A, C, "20", "cheapest-01", None);
    assert_eq!(q.total, "20.1");
    f.ok(vec![q.action(A)]);
    assert_eq!(f.owed(B, A), 0);
    assert_eq!(f.owed(D, A), 2_010_000_000);
    let stale = f.preview(A, C, "1", "pause-old-1", None);
    f.line(D, C, "0", 5_000, false);
    f.reject(vec![stale.action(A)], INVALID);
    let q = f.preview(A, C, "1", "alternate-1", None);
    assert_eq!(q.total, "1.01");
    f.ok(vec![q.action(A)]);
    f.line(B, C, "0", 10_000, false);
    f.unavailable(A, C, "USD", "1", "all-paused-1", None);
    let q = f.preview(B, C, "1", "own-paused-1", None);
    assert_eq!(q.total, "1");
    f.ok(vec![q.action(B)]);
}

#[test]
fn smallest_unit_fee_rounding_hundred_percent_and_max_amount() {
    let f = Fixture::new();
    f.network();
    f.line(B, C, "0", 1, true);
    let q = f.preview(A, C, "0.00000001", "rounding-01", None);
    assert_eq!(
        (q.total.as_str(), q.fee.as_str()),
        ("0.00000002", "0.00000001")
    );
    f.ok(vec![q.action(A)]);
    f.line(B, C, "0", 1_000_000, true);
    let q = f.preview(A, C, "1", "full-fee-01", None);
    assert_eq!(q.total, "2");
    f.ok(vec![q.action(A)]);
    f.line(D, A, "90000000", 0, true);
    let q = f.preview(A, D, "90000000", "maximum-001", None);
    f.ok(vec![q.action(A)]);
    assert_eq!(f.owed(D, A), routing::MAX_AMOUNT as i64);
    for amount in ["0", "-1", "90000000.00000001", "0.000000001"] {
        f.unavailable(A, C, "USD", amount, "bad-amount-1", None);
    }
    f.line(B, A, "90000000", 0, true);
    f.line(C, B, "90000000", 0, true);
    f.unavailable(A, C, "USD", "90000000", "fee-overflow", None);
}

#[test]
fn request_validation_owner_authorization_and_receiving_settings() {
    let f = Fixture::new();
    f.network();
    let expiry = f.time() + 3600;
    let create = |h: &str, symbol: &str, amount: &str, time, payer| {
        Wrapper::pack_from(C).create_request(h.into(), symbol.into(), amount.into(), time, payer)
    };
    for hash in [
        "",
        "xyz",
        &"ab".repeat(31),
        &"AB".repeat(32),
        &"ab".repeat(33),
    ] {
        f.reject(
            vec![create(hash, "USD", "1", expiry, None)],
            "Invalid payment request",
        );
    }
    for time in [0, f.time(), f.time() + 30 * 86400 + 10] {
        f.reject(
            vec![create(&"ab".repeat(32), "USD", "1", time, None)],
            "Choose an expiry within 30 days",
        );
    }
    f.reject(
        vec![create(&"ab".repeat(32), "usd", "1", expiry, None)],
        "Use a symbol of 2–12 uppercase letters",
    );
    f.reject(
        vec![create(&"ab".repeat(32), "USD", "-1", expiry, None)],
        "Use a nonnegative amount",
    );
    f.reject(
        vec![create(&"ab".repeat(32), "USD", "1", expiry, Some(C))],
        "Choose someone other than yourself",
    );
    f.reject(
        vec![create(
            &"ab".repeat(32),
            "USD",
            "1",
            expiry,
            Some(account!("nobody")),
        )],
        "Account does not exist",
    );
    let secret = f.request(C, 1, "1", Some(A), 3600);
    let hash = crypto::hash_secret(&secret).unwrap();
    f.reject(
        vec![create(&hash, "USD", "1", expiry, None)],
        "Payment request already exists",
    );
    f.reject(
        vec![Wrapper::pack_from(A).revoke_request(hash.clone())],
        "This payment request belongs to someone else",
    );
    f.reject(
        vec![Wrapper::pack_from(C).revoke_request("00".repeat(32))],
        "Payment request not found",
    );
    f.ok(vec![Wrapper::pack_from(C).set_receiving(true)]);
    assert_eq!(
        f.query(Some(C), "{settings{requestOnly}}")["data"]["settings"]["requestOnly"],
        true
    );
    assert_eq!(
        f.query(Some(A), "{settings{requestOnly}}")["data"]["settings"]["requestOnly"],
        false
    );
    f.unavailable(A, C, "USD", "1", "needs-request", None);
    f.ok(vec![Wrapper::pack_from(C).set_receiving(false)]);
    f.preview(A, C, "1", "open-receive", None);
    // Revocation is idempotent, owned by C, and does not erase the request.
    f.ok(vec![Wrapper::pack_from(C).revoke_request(hash.clone())]);
    f.ok(vec![Wrapper::pack_from(C).revoke_request(hash.clone())]);
    assert!(
        f.chain
            .open::<Request, Requests>()
            .get_index_pk()
            .get(&hash)
            .unwrap()
            .revoked
    );
}

#[test]
fn fixed_flexible_and_restricted_requests_are_checked_in_query_and_payment() {
    let f = Fixture::new();
    f.network();
    f.line(C, D, "100", 0, true); // wrong payer has a working route, so payer rejection is meaningful
    let secret = f.request(C, 2, "2", Some(A), 3600);
    f.unavailable(D, C, "USD", "2", "wrong-payer1", Some(&secret));
    f.unavailable(A, C, "USD", "1", "wrong-value1", Some(&secret));
    f.unavailable(A, B, "USD", "2", "wrong-owner1", Some(&secret));
    f.ok(vec![Wrapper::pack_from(C).set_line(
        B,
        "BTC".into(),
        "100".into(),
        0,
        true,
    )]);
    f.ok(vec![Wrapper::pack_from(B).set_line(
        A,
        "BTC".into(),
        "100".into(),
        0,
        true,
    )]);
    f.unavailable(A, C, "BTC", "2", "wrong-symbol", Some(&secret));
    for secret in ["bad", &"00".repeat(32)] {
        f.unavailable(A, C, "USD", "2", "wrong-secret", Some(secret));
    }
    let q = f.preview(A, C, "2", "invoice-pay1", Some(&secret));
    assert!(!q.encoded_route.contains(&secret));
    f.ok(vec![q.action(A)]);
    f.unavailable(A, C, "USD", "2", "used-invoice", Some(&secret));
    let mut replay = q.clone();
    replay.reference = "invoice-pay2".into();
    // Re-sealing with the test-only master key reaches the consumed-request check,
    // rather than failing on the original reference or envelope authentication.
    let e = Envelope::parse(&q.encoded_route).unwrap();
    let mut c = e.context.clone();
    c.reference = replay.reference.clone();
    let first = e.open(&[42; 32], &A.to_string(), 0).unwrap();
    let second = e.open(&[42; 32], &B.to_string(), 1).unwrap();
    replay.encoded_route = Envelope::seal(
        &[42; 32],
        c,
        &[(A.to_string(), first), (B.to_string(), second)],
        &[22; 360],
    )
    .unwrap();
    f.reject(vec![replay.action(A)], INVALID);
    let flexible = f.request(C, 3, "0", None, 3600);
    let q = f.preview(D, C, "0.00000001", "flexible-001", Some(&flexible));
    f.ok(vec![q.action(D)]);
    assert!(
        f.chain
            .open::<Request, Requests>()
            .get_index_pk()
            .get(&crypto::hash_secret(&flexible).unwrap())
            .unwrap()
            .consumed
    );
}

#[test]
fn policy_changes_revocation_and_request_expiry_invalidate_issued_routes() {
    let f = Fixture::new();
    f.network();
    let q = f.preview(A, C, "1", "policy-old-1", None);
    f.ok(vec![Wrapper::pack_from(C).set_receiving(true)]);
    f.reject(vec![q.action(A)], INVALID);
    let secret = f.request(C, 4, "1", None, 3600);
    let q = f.preview(A, C, "1", "revoke-old-1", Some(&secret));
    f.ok(vec![
        Wrapper::pack_from(C).revoke_request(crypto::hash_secret(&secret).unwrap())
    ]);
    f.reject(vec![q.action(A)], INVALID);
    f.unavailable(A, C, "USD", "1", "revoked-query", Some(&secret));
    let secret = f.request(C, 5, "1", None, 10);
    let q = f.preview(A, C, "1", "expired-inv1", Some(&secret));
    let env = Envelope::parse(&q.encoded_route).unwrap();
    let request = f
        .chain
        .open::<Request, Requests>()
        .get_index_pk()
        .get(&crypto::hash_secret(&secret).unwrap())
        .unwrap();
    assert_eq!(env.context.expires_at, request.expires_at);
    f.chain.start_block_after(Seconds::from_ticks(11).into());
    f.reject(vec![q.action(A)], INVALID);
    f.unavailable(A, C, "USD", "1", "expired-query", Some(&secret));
}

#[test]
fn whole_transaction_rollback_restores_every_table_and_allows_retry() {
    let f = Fixture::new();
    f.network();
    let secret = f.request(C, 6, "1", Some(A), 3600);
    let q = f.preview(A, C, "1", "atomic-pay-1", Some(&secret));
    let fail = Wrapper::pack_from(A).set_line(A, "USD".into(), "1".into(), 0, true);
    f.reject(
        vec![
            q.action(A),
            Wrapper::pack_from(D).set_line(A, "BTC".into(), "1".into(), 0, true),
            Wrapper::pack_from(D).set_receiving(true),
            Wrapper::pack().rotate_key(vec![99; 32].into()),
            fail.clone(),
        ],
        "Choose someone other than yourself",
    );
    assert!(f
        .chain
        .open::<Line, Lines>()
        .get_index_by_pair()
        .get(&pair_key("BTC", D, A))
        .is_none());
    // The same route/reference/request still succeeds: no counters, replay
    // markers, receipts, balances, keys, or invoice consumption leaked.
    f.ok(vec![q.action(A)]);
    assert_eq!(
        f.chain
            .open::<Payment, Payments>()
            .get_index_pk()
            .get(&(A, q.reference.clone()))
            .unwrap()
            .id,
        1
    );
    let settlement =
        Wrapper::pack_from(C).settle(B, "USD".into(), "1".into(), "atomic-settle".into());
    f.reject(
        vec![settlement.clone(), fail.clone()],
        "Choose someone other than yourself",
    );
    f.ok(vec![settlement]);
    assert_eq!(f.owed(C, B), 0);
    let hash = "cc".repeat(32);
    f.reject(
        vec![
            Wrapper::pack_from(C).create_request(
                hash.clone(),
                "USD".into(),
                "0".into(),
                f.time() + 3600,
                None,
            ),
            Wrapper::pack_from(C).revoke_request(hash),
            fail,
        ],
        "Choose someone other than yourself",
    );
}

#[test]
fn repayments_only_creditor_acknowledges_positive_existing_debt() {
    let f = Fixture::new();
    f.line(B, A, "10", 0, true);
    let settle = |who, peer, s: &str, amount: &str, nonce: &str| {
        Wrapper::pack_from(who).settle(peer, s.into(), amount.into(), nonce.into())
    };
    f.reject(
        vec![settle(B, A, "USD", "1", "no-debt-001")],
        "Repayment cannot exceed what this person owes you",
    );
    f.reject(
        vec![settle(A, C, "USD", "1", "no-line-001")],
        "No relationship with this person",
    );
    f.reject(
        vec![settle(A, A, "USD", "1", "self-settle1")],
        "Choose someone other than yourself",
    );
    f.reject(
        vec![settle(A, account!("nobody"), "USD", "1", "bad-peer-001")],
        "Account does not exist",
    );
    f.reject(
        vec![settle(A, B, "usd", "1", "bad-sym-0001")],
        "Use a symbol of 2–12 uppercase letters",
    );
    let q = f.preview(A, B, "5", "debt-pay-001", None);
    f.ok(vec![q.action(A)]);
    for amount in ["0", "5.00000001", "6"] {
        f.reject(
            vec![settle(B, A, "USD", amount, "over-repay-1")],
            "Repayment cannot exceed what this person owes you",
        );
    }
    f.reject(
        vec![settle(B, A, "USD", "-1", "bad-repay-01")],
        "Use a nonnegative amount",
    );
    f.reject(
        vec![settle(A, B, "USD", "1", "wrong-side-1")],
        "Repayment cannot exceed what this person owes you",
    );
    f.reject(
        vec![settle(B, A, "USD", "1", "bad!")],
        "Invalid payment reference",
    );
    f.ok(vec![settle(B, A, "USD", "2", "repay-part-1")]);
    assert_eq!(f.owed(B, A), 3 * routing::SCALE as i64);
    f.reject(
        vec![settle(B, A, "USD", "2", "repay-part-1")],
        "This payment reference has already been used",
    );
    f.ok(vec![settle(B, A, "USD", "3", "repay-full-1")]);
    assert_eq!(f.owed(B, A), 0);
    let receipts: Vec<_> = f
        .chain
        .open::<Receipt, Receipts>()
        .get_index_pk()
        .iter()
        .filter(|r| r.id == 3)
        .collect();
    assert_eq!(receipts.len(), 2);
    assert_eq!(
        receipts.iter().find(|r| r.owner == B).unwrap().kind,
        "repayment-recorded"
    );
    assert_eq!(
        receipts.iter().find(|r| r.owner == A).unwrap().kind,
        "repaid"
    );
    assert!(receipts
        .iter()
        .all(|r| r.memo.is_empty() && r.received == 3 * routing::SCALE));
}

#[test]
fn seven_hops_succeed_eight_hops_fail_and_route_replays_on_fresh_chain() {
    let f = Fixture::new();
    let users = [
        A,
        B,
        C,
        D,
        account!("eve"),
        account!("frank"),
        account!("grace"),
        account!("heidi"),
        account!("ivan"),
    ];
    for user in &users[4..] {
        f.chain.new_account(*user).unwrap();
    }
    for i in 1..users.len() {
        f.line(users[i], users[i - 1], "100", 0, true);
    }
    let g = Fixture {
        chain: f.chain.fork(),
    };
    // fork() advances only the child so repeated siblings share a timestamp.
    // Advance the parent once to give both transactions the same TAPOS context.
    f.chain.start_block();
    let q = f.preview(A, users[7], "1", "seven-hops-1", None);
    f.unavailable(A, users[8], "USD", "1", "eight-hops-1", None);
    // g has never seen a query for this route. Its state matches f, including row
    // IDs/key epoch, and can execute the complete transaction without a cache.
    let transaction = f.pack_transaction(vec![q.action(A)]);
    let replay_transaction = g.pack_transaction(vec![q.action(A)]);
    assert_eq!(
        transaction.transaction,
        replay_transaction.transaction,
        "both chains must assemble identical transactions, including TAPOS"
    );
    g.chain.push(&transaction).ok().unwrap();
    f.chain.push(&transaction).ok().unwrap();
    g.chain.start_block();
    f.chain.start_block();
    for i in 1..=7 {
        assert_eq!(f.owed(users[i], users[i - 1]), routing::SCALE as i64);
        assert_eq!(g.owed(users[i], users[i - 1]), routing::SCALE as i64);
    }
    assert_eq!(f.owed(users[8], users[7]), 0);
    let receipts: Vec<_> = f
        .chain
        .open::<Receipt, Receipts>()
        .get_index_pk()
        .iter()
        .collect();
    assert_eq!(receipts.len(), 8);
    for i in 1..7 {
        let receipt = receipts.iter().find(|r| r.owner == users[i]).unwrap();
        assert_eq!(
            (receipt.incoming, receipt.outgoing),
            (Some(users[i - 1]), Some(users[i + 1]))
        );
        assert_eq!(
            (receipt.received, receipt.sent),
            (routing::SCALE, routing::SCALE)
        );
        assert!(receipt.memo.is_empty());
    }
    assert!(f.snapshot() == g.snapshot());
    // Symbols partition the ledger, including when the same people are linked
    // in both networks. A BTC payment cannot consume their USD capacity.
    f.ok(vec![Wrapper::pack_from(B).set_line(
        A,
        "BTC".into(),
        "2".into(),
        0,
        true,
    )]);
    let result = f.preview_result(A, B, "BTC", "1", "bitcoin-0001", None);
    let bitcoin: Preview = serde_json::from_value(result["data"]["quote"].clone()).unwrap();
    f.ok(vec![bitcoin.action(A)]);
    assert_eq!(f.row(A, B, "BTC").balance.unsigned_abs(), routing::SCALE);
    assert_eq!(f.owed(B, A), routing::SCALE as i64);
}

#[test]
fn authenticated_queries_restrict_identity_and_paginate_private_rows() {
    let f = Fixture::new();
    f.network();
    f.line(D, A, "100", 0, true);
    for field in [
        "lines{nodes{peer}}",
        "activity{nodes{id}}",
        "requests{nodes{hash}}",
        "settings{requestOnly}",
        "quote(payee:\"carol\",symbol:\"USD\",amount:\"1\",reference:\"anonymous-01\"){total}",
    ] {
        let r = f.query(None, &format!("{{{field}}}"));
        assert_eq!(
            r["errors"][0]["message"],
            "Sign in to view your private credit network"
        );
    }
    let out = f.query(
        Some(D),
        "{lines{nodes{peer}} activity{nodes{id}} requests{nodes{hash}}}",
    );
    assert_eq!(out["data"]["lines"]["nodes"], json!([{"peer":"alice"}]));
    assert_eq!(out["data"]["activity"]["nodes"], json!([]));
    let one = f.query(
        Some(A),
        "{lines(first:1){nodes{peer} endCursor hasNextPage}}",
    );
    assert_eq!(one["data"]["lines"]["hasNextPage"], true);
    let cursor = &one["data"]["lines"]["endCursor"];
    let two = f.query(
        Some(A),
        &format!("{{lines(first:1,after:{cursor}){{nodes{{peer}} hasNextPage}}}}"),
    );
    assert_eq!(two["data"]["lines"]["hasNextPage"], false);
    assert_ne!(one["data"]["lines"]["nodes"], two["data"]["lines"]["nodes"]);
    let mut hashes = Vec::new();
    for n in 20..23 {
        hashes.push(crypto::hash_secret(&f.request(C, n, "0", None, 3600)).unwrap());
    }
    hashes.sort();
    let mut cursor = String::new();
    for (i, hash) in hashes.iter().enumerate() {
        let r = f.query(
            Some(C),
            &format!(
                "{{requests(first:1,after:{}){{nodes{{hash}} endCursor hasNextPage}}}}",
                json!(cursor)
            ),
        );
        assert_eq!(r["data"]["requests"]["nodes"], json!([{"hash":hash}]));
        assert_eq!(r["data"]["requests"]["hasNextPage"], i < 2);
        cursor = r["data"]["requests"]["endCursor"].as_str().unwrap().into();
    }
    for i in 0..3 {
        let q = f.preview(A, C, "1", &format!("activity-{i:03}"), None);
        f.ok(vec![q.action(A)]);
    }
    let mut before = None;
    for id in (1..=3).rev() {
        let arg = before
            .as_ref()
            .map(|b: &String| format!(",before:{}", json!(b)))
            .unwrap_or_default();
        let r=f.query(Some(B),&format!("{{activity(first:1{arg}){{nodes{{id incoming outgoing memo earned}} endCursor hasNextPage}}}}"));
        let page = &r["data"]["activity"];
        assert_eq!(
            page["nodes"],
            json!([{"id":id.to_string(),"incoming":"alice","outgoing":"carol","memo":"","earned":"0.01"}])
        );
        assert_eq!(page["hasNextPage"], id > 1);
        before = Some(page["endCursor"].as_str().unwrap().into());
    }
    let r = f.query(Some(B), "{activity(before:\"garbage\"){nodes{id}}}");
    assert_eq!(r["errors"][0]["message"], "Invalid activity cursor");
    let r = f.query(Some(A), "{lines(user:\"carol\"){nodes{peer}}}");
    assert!(r.get("errors").is_some());
    // Pack the actual serveSys ABI; an ordinary sender cannot assert user=C.
    #[derive(psio::PsszPack)]
    struct Serve {
        request: HttpRequest,
        socket: Option<i32>,
        user: Option<AccountNumber>,
    }
    let action = Action {
        sender: A,
        service: Q,
        method: method!("serveSys"),
        rawData: psio::to_pssz(&Serve {
            request: HttpRequest {
                host: "favor.psibase.io".into(),
                method: "POST".into(),
                target: "/graphql".into(),
                contentType: "application/json".into(),
                body: br#"{"query":"{lines{nodes{peer}}}"}"#.to_vec().into(),
                headers: vec![],
            },
            socket: None,
            user: Some(C),
        })
        .into(),
    };
    f.reject(vec![action], "Only http-server may supply query identity");
}

#[test]
fn signed_transactions_require_the_senders_key_and_valid_signature() {
    use p256::{
        ecdsa::{signature::Signer, Signature, SigningKey},
        pkcs8::EncodePublicKey,
    };
    let f = Fixture::new();
    f.network();
    let q = f.preview(A, C, "1", "signed-pay-1", None);
    let alice = SigningKey::from_bytes((&[1; 32]).into()).unwrap();
    let bob = SigningKey::from_bytes((&[2; 32]).into()).unwrap();
    let admin = SigningKey::from_bytes((&[3; 32]).into()).unwrap();
    let public = |key: &SigningKey| {
        key.verifying_key()
            .to_public_key_der()
            .unwrap()
            .as_bytes()
            .to_vec()
    };
    for (user, key) in [(A, &alice), (B, &bob), (Wrapper::SERVICE, &admin)] {
        f.ok(vec![
            services::auth_sig::Wrapper::pack_from(user).setKey(public(key).into()),
            services::accounts::Wrapper::pack_from(user).setAuthServ(services::auth_sig::SERVICE),
        ]);
    }
    let sign = |actions: Vec<Action>, claim: &SigningKey, signer: &SigningKey| {
        let mut signed = f.signed_transaction(actions);
        let mut tx = signed.transaction.decode().unwrap();
        tx.claims = vec![Claim {
            service: services::verify_sig::SERVICE,
            rawData: public(claim).into(),
        }];
        let bytes = psio::to_pssz(&tx);
        let sig: Signature = signer.sign(&bytes);
        signed.transaction = psio::pssz::Nested::unchecked(bytes);
        signed.proofs = vec![sig.to_bytes().to_vec().into()];
        signed
    };
    let reject = |signed: SignedTransaction, error: &str| {
        let before = f.snapshot();
        let trace = f.chain.push(&signed);
        f.chain.start_block();
        assert!(
            trace.error_text().as_deref().is_some_and(|e| e.contains(error)),
            "expected {error}; got {:?}",
            trace.error
        );
        assert!(
            before == f.snapshot(),
            "failed authentication changed state"
        );
    };
    reject(
        f.signed_transaction(vec![q.action(A)]),
        "Authorization for alice -> favor::pay failed",
    );
    reject(
        sign(vec![q.action(A)], &bob, &bob),
        "Authorization for alice -> favor::pay failed",
    );
    reject(sign(vec![q.action(A)], &alice, &bob), "signature invalid");
    let mut corrupt = sign(vec![q.action(A)], &alice, &alice);
    corrupt.proofs[0][0] ^= 1;
    reject(corrupt, "signature invalid");
    // A correct signature on a different sender is still a forged identity.
    reject(
        sign(
            vec![Wrapper::pack_from(B).set_receiving(true)],
            &alice,
            &alice,
        ),
        &format!(
            "Authorization for bob -> favor::{} failed",
            method!("set_receiving")
        ),
    );
    f.chain
        .push(&sign(vec![q.action(A)], &alice, &alice))
        .ok()
        .unwrap();
    f.chain.start_block();
    assert_eq!(f.owed(B, A), 101_000_000);
    assert_eq!(f.owed(C, B), 100_000_000);
    f.chain
        .push(&sign(
            vec![Wrapper::pack_from(B).set_line(A, "USD".into(), "99".into(), 0, true)],
            &bob,
            &bob,
        ))
        .ok()
        .unwrap();
    f.chain.start_block();
    reject(
        sign(
            vec![Wrapper::pack().rotate_key(vec![50; 32].into())],
            &alice,
            &alice,
        ),
        &format!(
            "Authorization for favor -> favor::{} failed",
            method!("rotate_key")
        ),
    );
    f.chain
        .push(&sign(
            vec![Wrapper::pack().rotate_key(vec![50; 32].into())],
            &admin,
            &admin,
        ))
        .ok()
        .unwrap();
    f.chain.start_block();
    assert_eq!(
        f.chain
            .open::<RouteKey, RouteKeys>()
            .get_index_pk()
            .get(&0)
            .unwrap()
            .epoch,
        2
    );
}

#[test]
fn memo_and_reference_boundaries_and_sender_nonce_scope() {
    let f = Fixture::new();
    f.line(B, A, "100", 0, true);
    f.line(A, B, "100", 0, true);
    for reference in ["short", &"a".repeat(65), "invalid_ref", "unicode-é"] {
        f.unavailable(A, B, "USD", "1", reference, None);
        let q = f.preview(A, B, "1", "valid-ref-01", None);
        let mut bad = q.clone();
        bad.reference = reference.into();
        f.reject(vec![bad.action(A)], "Invalid payment reference");
    }
    for (i, reference) in ["12345678".to_string(), "a".repeat(64)]
        .into_iter()
        .enumerate()
    {
        let q = f.preview(A, B, "1", &reference, None);
        f.ok(vec![Wrapper::pack_from(A).pay(
            B,
            "USD".into(),
            q.amount.clone(),
            q.total.clone(),
            q.encoded_route.clone(),
            q.reference.clone(),
            if i == 0 {
                "🙂".repeat(64)
            } else {
                String::new()
            },
        )]);
        let reverse = f.preview(B, A, "1", &reference, None);
        f.ok(vec![reverse.action(B)]);
    }
    assert_eq!(f.owed(A, B), 0);
}

/// Independent small-graph oracle: enumerate every simple path and price it
/// backwards. This intentionally does not call routing::find_route/capacity.
fn oracle_total(
    payer: usize,
    payee: usize,
    amount: u64,
    debt: &[[i64; 4]; 4],
    limits: &[[u64; 4]; 4],
    fees: &[[u32; 4]; 4],
    forwards: &[[bool; 4]; 4],
) -> Option<u64> {
    fn visit(
        path: &mut Vec<usize>,
        payee: usize,
        amount: u64,
        debt: &[[i64; 4]; 4],
        limits: &[[u64; 4]; 4],
        fees: &[[u32; 4]; 4],
        forwards: &[[bool; 4]; 4],
        best: &mut Option<u64>,
    ) {
        let from = *path.last().unwrap();
        if from == payee {
            let mut cost = amount;
            for i in (0..path.len() - 1).rev() {
                let (a, b) = (path[i], path[i + 1]);
                if cost as i128 > (limits[b][a] as i128 + debt[a][b] as i128).max(0) {
                    return;
                }
                if i > 0 {
                    if !forwards[a][b] {
                        return;
                    }
                    cost += (cost * fees[a][b] as u64 + 999_999) / 1_000_000;
                }
            }
            *best = Some(best.map_or(cost, |old| old.min(cost)));
            return;
        }
        for next in 0..4 {
            if !path.contains(&next) {
                path.push(next);
                visit(path, payee, amount, debt, limits, fees, forwards, best);
                path.pop();
            }
        }
    }
    let mut best = None;
    visit(
        &mut vec![payer],
        payee,
        amount,
        debt,
        limits,
        fees,
        forwards,
        &mut best,
    );
    best
}

#[test]
fn randomized_transactions_match_independent_ledger_and_exhaustive_price_oracle() {
    let f = Fixture::new();
    let users = [A, B, C, D];
    let mut debt = [[0_i64; 4]; 4];
    let mut limits = [[0_u64; 4]; 4];
    let mut fees = [[0_u32; 4]; 4];
    let mut forwards = [[true; 4]; 4];
    let mut ids = std::collections::BTreeMap::new();
    let mut next_id = 1;
    for a in 0..4 {
        for b in 0..4 {
            if a == b {
                continue;
            }
            limits[a][b] = 10 * routing::SCALE;
            fees[a][b] = if (a + b) % 2 == 0 { 50_000 } else { 0 };
            f.line(users[a], users[b], "10", fees[a][b], true);
            let key = (a.min(b), a.max(b));
            if !ids.contains_key(&key) {
                ids.insert(key, next_id);
                next_id += 1;
            }
        }
    }
    let mut rng = 0xd12a_7ed5_73af_19b9_u64;
    let mut draw = || {
        rng ^= rng << 13;
        rng ^= rng >> 7;
        rng ^= rng << 17;
        rng
    };
    let mut paid = 0;
    let mut denied = 0;
    let mut settled = 0;
    for step in 0..160 {
        let a = (draw() % 4) as usize;
        let mut b = (draw() % 3) as usize;
        if b >= a {
            b += 1;
        }
        let reference = format!("state-machine-{step:04}");
        if step % 5 == 0 {
            limits[a][b] = (draw() % 12) * routing::SCALE;
            fees[a][b] = [0, 1, 10_000, 1_000_000][(draw() % 4) as usize];
            forwards[a][b] = draw() % 3 != 0;
            f.line(
                users[a],
                users[b],
                &routing::decimal(limits[a][b]),
                fees[a][b],
                forwards[a][b],
            );
        } else if step % 7 == 0 && debt[a][b] > 0 {
            let amount = (debt[a][b] as u64 / 2).max(1);
            f.ok(vec![Wrapper::pack_from(users[a]).settle(
                users[b],
                "USD".into(),
                routing::decimal(amount),
                reference,
            )]);
            debt[a][b] -= amount as i64;
            debt[b][a] += amount as i64;
            settled += 1;
        } else {
            let amount = 1 + draw() % (5 * routing::SCALE);
            let expected = oracle_total(a, b, amount, &debt, &limits, &fees, &forwards);
            if let Some(total) = expected {
                let q = f.preview(
                    users[a],
                    users[b],
                    &routing::decimal(amount),
                    &reference,
                    None,
                );
                assert_eq!(
                    routing::units(&q.total).unwrap(),
                    total,
                    "oracle disagrees at step {step}"
                );
                if step % 3 == 0 {
                    let mut bad = q.clone();
                    bad.total = routing::decimal(total - 1);
                    f.reject(vec![bad.action(users[a])], INVALID);
                }
                let e = Envelope::parse(&q.encoded_route).unwrap();
                let mut current = a;
                let mut path = Vec::new();
                for slot in 0..7 {
                    let hop = e
                        .open(&[42; 32], &users[current].to_string(), slot)
                        .unwrap();
                    let (&(x, y), _) = ids.iter().find(|(_, id)| **id == hop.line).unwrap();
                    let next = if current == x {
                        y
                    } else {
                        assert_eq!(current, y);
                        x
                    };
                    assert!(!path.iter().any(|(from, _, _)| *from == next), "cycle");
                    assert!(
                        hop.amount as i128
                            <= (limits[next][current] as i128 + debt[current][next] as i128).max(0)
                    );
                    path.push((current, next, hop.amount));
                    current = next;
                    if hop.end {
                        break;
                    }
                }
                assert_eq!(current, b);
                assert_eq!(path[0].2, total);
                assert_eq!(path.last().unwrap().2, amount);
                for i in 1..path.len() {
                    let (from, to, outgoing) = path[i];
                    assert!(forwards[from][to]);
                    assert_eq!(
                        path[i - 1].2,
                        outgoing + (outgoing * fees[from][to] as u64 + 999_999) / 1_000_000
                    );
                }
                f.ok(vec![q.action(users[a])]);
                for (from, to, amount) in path {
                    debt[from][to] -= amount as i64;
                    debt[to][from] += amount as i64;
                }
                paid += 1;
            } else {
                f.unavailable(
                    users[a],
                    users[b],
                    "USD",
                    &routing::decimal(amount),
                    &reference,
                    None,
                );
                denied += 1;
            }
        }
        let mut net = [0_i128; 4];
        for x in 0..4 {
            for y in x + 1..4 {
                assert_eq!(debt[x][y], -debt[y][x]);
                assert_eq!(f.owed(users[x], users[y]), debt[x][y], "ledger step {step}");
                net[x] += debt[x][y] as i128;
                net[y] -= debt[x][y] as i128;
            }
        }
        assert_eq!(net.iter().sum::<i128>(), 0);
    }
    assert!(
        paid > 50 && denied > 0 && settled > 0,
        "fixture failed to exercise both outcomes: {paid}/{denied}/{settled}"
    );
    println!("state machine: {paid} payments, {denied} unavailable routes, {settled} repayments; 160 transitions checked");
}
