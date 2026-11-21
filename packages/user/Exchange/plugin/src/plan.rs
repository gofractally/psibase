//! Bounded client orchestration, never a ledger or matching engine. A fresh
//! authenticated native snapshot supplies exact owner receipts and settings.
//! Every action below is still checked by its native service at execution.
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

pub const MAX_AMOUNT: u64 = (1 << 40) - 1;
pub const MAX_CLAIMS: usize = 32;
pub const MAX_ACTIONS: usize = 64;
pub const PAGE_LIMIT: usize = 200;
pub const MAX_CURSOR_BYTES: usize = 8192;
pub type Amounts = BTreeMap<u32, u64>;

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct Action {
    pub method: String,
    pub args: Value,
}
impl Action {
    pub fn number(&self, key: &str) -> u64 {
        number(&self.args[key]).expect("validated action")
    }
    pub fn flag(&self, key: &str) -> bool {
        self.args[key].as_bool().expect("validated action")
    }
    pub fn new(method: &str, args: Value) -> Result<Self, String> {
        let (ints, flags): (&[&str], &[&str]) = match method {
            "create" => (
                &[
                    "base",
                    "quote",
                    "base_amount",
                    "quote_amount",
                    "base_lot",
                    "quote_tick",
                ],
                &[],
            ),
            "trade" => (
                &["market", "amount", "min_output", "max_events"],
                &["sell_base"],
            ),
            "limit" => (&["market", "price", "amount"], &["bid"]),
            "cancel" | "settle" => (&["market", "price"], &["bid"]),
            "stop" => (&["market", "trigger", "amount"], &["sell_base"]),
            "cancelstop" | "claimstop" => (&["generation"], &[]),
            "lend" => (&["market", "amount"], &["base"]),
            "unlend" => (&["market", "shares"], &["base"]),
            "borrow" | "repay" => (&["market", "price", "units"], &["long"]),
            "claim" => (&["market", "price"], &["long"]),
            "liquidate" => (&["market", "max_events"], &[]),
            "addliq" | "remliq" => (&["market", "shares"], &[]),
            "process" | "renew" => (&["market"], &[]),
            _ => return Err("Unsupported exchange action".into()),
        };
        let map = args
            .as_object()
            .ok_or("Action arguments must be an object")?;
        let keys: BTreeSet<_> = ints.iter().chain(flags).copied().collect();
        if map.len() != keys.len() || map.keys().any(|k| !keys.contains(k.as_str())) {
            return Err("Unexpected or missing action argument".into());
        }
        let mut normalized = serde_json::Map::new();
        for name in ints {
            let n = number(&args[*name])?;
            if ["base", "quote"].contains(name) && n > u32::MAX as u64 {
                return Err("Token ID exceeds u32".into());
            }
            if *name == "max_events" && n > 256 {
                return Err("Event budget exceeds 256".into());
            }
            if !["min_output", "max_events", "base", "quote"].contains(name) && n == 0 {
                return Err(format!("{name} must be positive"));
            }
            if [
                "amount",
                "shares",
                "units",
                "base_amount",
                "quote_amount",
                "base_lot",
                "quote_tick",
            ]
            .contains(name)
                && n > MAX_AMOUNT
            {
                return Err("Amount exceeds native record limit".into());
            }
            normalized.insert((*name).into(), json!(n));
        }
        for name in flags {
            normalized.insert(
                (*name).into(),
                json!(args[*name].as_bool().ok_or("Invalid action side")?),
            );
        }
        Ok(Self {
            method: method.into(),
            args: Value::Object(normalized),
        })
    }
}

/// A stale tab may confirm intent for another wallet, but can never select an
/// action sender. Host's authoritative user must still equal the reviewed user.
pub fn expected_owner(expected: &str, current: Option<&str>) -> Result<(), String> {
    if expected.is_empty() || current != Some(expected) {
        return Err("The connected account changed; review the transaction again".into());
    }
    Ok(())
}

pub fn number(v: &Value) -> Result<u64, String> {
    if let Some(s) = v.as_str() {
        if s.is_empty() || !s.bytes().all(|b| b.is_ascii_digit()) {
            return Err("Invalid unsigned integer".into());
        }
        s.parse().map_err(|_| "Integer exceeds u64".into())
    } else {
        v.as_u64()
            .ok_or_else(|| "Expected integer atoms or decimal integer string".into())
    }
}
fn n(v: &Value) -> u64 {
    number(v).unwrap_or(0)
}
fn rows<'a>(v: &'a Value, key: &str) -> impl Iterator<Item = &'a Value> {
    v[key].as_array().into_iter().flatten()
}
fn market<'a>(s: &'a Value, id: u64) -> Result<&'a Value, String> {
    rows(s, "markets")
        .find(|m| n(&m["id"]) == id)
        .ok_or_else(|| "Unknown market".into())
}
fn capped(value: u128) -> Result<u64, String> {
    if value == 0 || value > MAX_AMOUNT as u128 {
        Err("Amount exceeds native record limit".into())
    } else {
        Ok(value as u64)
    }
}
pub fn required(s: &Value, a: &Action) -> Result<Amounts, String> {
    let mut result = Amounts::new();
    if a.method == "create" {
        let (base, quote) = (a.number("base") as u32, a.number("quote") as u32);
        if base == quote {
            return Err("Choose two different tokens".into());
        }
        result.insert(base, a.number("base_amount"));
        result.insert(quote, a.number("quote_amount"));
        return Ok(result);
    }
    if ![
        "trade", "limit", "stop", "lend", "borrow", "repay", "addliq",
    ]
    .contains(&a.method.as_str())
    {
        return Ok(result);
    }
    let m = market(s, a.number("market"))?;
    let (base, quote) = (n(&m["base"]) as u32, n(&m["quote"]) as u32);
    match a.method.as_str() {
        "trade" | "stop" => {
            result.insert(
                if a.flag("sell_base") { base } else { quote },
                a.number("amount"),
            );
        }
        "limit" => {
            result.insert(if a.flag("bid") { quote } else { base }, a.number("amount"));
        }
        "lend" => {
            result.insert(
                if a.flag("base") { base } else { quote },
                a.number("amount"),
            );
        }
        "borrow" | "repay" => {
            let long = a.flag("long");
            let units = a.number("units") as u128;
            let price = a.number("price") as u128;
            let lot = n(&m["base_lot"]) as u128;
            let tick = n(&m["quote_tick"]) as u128;
            let face = capped(
                units
                    .checked_mul(if long {
                        price.checked_mul(tick).ok_or("Amount overflow")?
                    } else {
                        lot
                    })
                    .ok_or("Amount overflow")?,
            )?;
            if a.method == "repay" {
                result.insert(if long { quote } else { base }, face);
            } else {
                result.insert(
                    if long { base } else { quote },
                    capped(
                        2u128
                            .checked_mul(units)
                            .and_then(|v| {
                                v.checked_mul(if long { lot } else { price.checked_mul(tick)? })
                            })
                            .ok_or("Amount overflow")?,
                    )?,
                );
            }
        }
        "addliq" => {
            let shares = a.number("shares") as u128;
            let supply = n(&m["lp_supply"]) as u128;
            capped(supply + shares)?;
            if supply == 0 {
                return Err("Invalid liquidity supply".into());
            }
            for (t, reserve) in [(base, "x"), (quote, "y")] {
                result.insert(
                    t,
                    capped((shares * n(&m[reserve]) as u128 + supply - 1) / supply)?,
                );
            }
        }
        _ => unreachable!(),
    }
    Ok(result)
}
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct Claim {
    pub action: Action,
    pub payouts: Amounts,
}
fn add_claim(
    entries: &mut Vec<Claim>,
    method: &str,
    args: Value,
    payouts: impl IntoIterator<Item = (u32, u64)>,
) {
    let payouts: Amounts = payouts.into_iter().filter(|(_, v)| *v > 0).collect();
    if !payouts.is_empty() {
        entries.push(Claim {
            action: Action::new(method, args).expect("native receipt args"),
            payouts,
        });
    }
}
fn eligible<'a>(s: &'a Value, p: &Value) -> Option<&'a Value> {
    if p["owner"]
        .as_str()
        .is_some_and(|owner| Some(owner) != s["owner"].as_str())
    {
        return None;
    }
    let m = market(s, n(&p["market"])).ok()?;
    if m["legacy_unsupported"] == true {
        return None;
    }
    for side in ["escrow_base", "escrow_quote"] {
        if m.get(side).is_some() && m[side]["funded"] != true {
            return None;
        }
    }
    Some(m)
}
pub fn claims(s: &Value) -> Vec<Claim> {
    let mut result = vec![];
    for p in rows(s, "positions") {
        if let Some(m) = eligible(s, p) {
            let bid = p["bid"] == true;
            add_claim(
                &mut result,
                "settle",
                json!({"market":p["market"],"bid":bid,"price":p["price"]}),
                [(
                    n(&m[if bid { "base" } else { "quote" }]) as u32,
                    n(&p["proceeds"]),
                )],
            );
        }
    }
    for p in rows(s, "loan_positions") {
        if let Some(m) = eligible(s, p) {
            if let Some(g) = rows(s, "loans")
                .find(|g| n(&g["generation"]) == n(&p["generation"]) && g["active"] == false)
            {
                // New native projection supplies the exact immutable-denominator amount.
                if let Ok(paid) = number(&g["claimable_surplus"]) {
                    let long = p["long"] == true;
                    add_claim(
                        &mut result,
                        "claim",
                        json!({"market":p["market"],"long":long,"price":p["price"]}),
                        [(n(&m[if long { "quote" } else { "base" }]) as u32, paid)],
                    );
                }
            }
        }
    }
    for p in rows(s, "stop_positions") {
        if let Some(m) = eligible(s, p) {
            if !["filled", "partially_filled", "unfilled"]
                .contains(&p["status"].as_str().unwrap_or(""))
                || p["can_claim"] == false
            {
                continue;
            }
            let sell = p["sell_base"] == true;
            add_claim(
                &mut result,
                "claimstop",
                json!({"generation":p["generation"]}),
                [
                    (
                        n(&m[if sell { "base" } else { "quote" }]) as u32,
                        n(&p["claimable_input"]),
                    ),
                    (
                        n(&m[if sell { "quote" } else { "base" }]) as u32,
                        n(&p["claimable_output"]),
                    ),
                ],
            );
        }
    }
    result
}
pub fn balance<'a>(s: &'a Value, token: u32) -> Option<&'a Value> {
    rows(s, "balances").find(|b| n(b.get("token_id").unwrap_or(&b["token"])) == token as u64)
}
pub fn shared(s: &Value, token: u32) -> u128 {
    balance(s, token)
        .map(|b| n(&b["incoming"]) as u128 + n(&b["outgoing"]) as u128)
        .unwrap_or(0)
}
pub fn auto_debit(s: &Value, token: u32) -> bool {
    balance(s, token).is_some_and(|b| b["auto_debit"] == true)
}
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct Preparation {
    pub claims: Vec<Claim>,
    pub accrued: Amounts,
    pub ready: bool,
}
pub fn prepare(s: &Value, required: &Amounts) -> Result<Preparation, String> {
    let missing: BTreeMap<u32, u128> = required
        .iter()
        .filter_map(|(&t, &v)| {
            let ready = shared(s, t);
            (ready < (v as u128)).then_some((t, (v as u128).saturating_sub(ready)))
        })
        .collect();
    let selected = vec![];
    let accrued = Amounts::new();
    if missing.is_empty() {
        return Ok(Preparation {
            claims: selected,
            accrued,
            ready: true,
        });
    }
    let entries = claims(s);
    select(s, required, entries, true)
}

fn select(
    s: &Value,
    required: &Amounts,
    entries: Vec<Claim>,
    require_sufficient: bool,
) -> Result<Preparation, String> {
    let mut missing: BTreeMap<u32, u128> = required
        .iter()
        .filter_map(|(&t, &v)| {
            let ready = shared(s, t);
            (ready < v as u128).then_some((t, (v as u128).saturating_sub(ready)))
        })
        .collect();
    let mut selected = vec![];
    let mut accrued = Amounts::new();
    if require_sufficient {
        for (&token, &need) in &missing {
            if entries
                .iter()
                .map(|e| e.payouts.get(&token).copied().unwrap_or(0) as u128)
                .sum::<u128>()
                < need
            {
                return Err(
                    "Insufficient available funds; deposit funds or reduce the amount".into(),
                );
            }
        }
    }
    for entry in entries {
        if !missing
            .iter()
            .any(|(t, v)| *v > 0 && entry.payouts.get(t).copied().unwrap_or(0) > 0)
        {
            continue;
        }
        let mut candidate = accrued.clone();
        for (&token, &amount) in &entry.payouts {
            let sum = candidate
                .get(&token)
                .copied()
                .unwrap_or(0)
                .checked_add(amount)
                .ok_or("Receipt amount overflow")?;
            candidate.insert(token, sum);
        }
        let recredits = candidate.keys().filter(|&&t| auto_debit(s, t)).count();
        if selected.len() + 1 + recredits + 2 > MAX_ACTIONS {
            break;
        }
        for (t, v) in &mut missing {
            *v = v.saturating_sub(entry.payouts.get(t).copied().unwrap_or(0) as u128);
        }
        accrued = candidate;
        selected.push(entry);
        if selected.len() == MAX_CLAIMS || missing.values().all(|v| *v == 0) {
            break;
        }
    }
    if require_sufficient && selected.is_empty() {
        return Err("Your balance is updating; retry after releasing an older receipt".into());
    }
    Ok(Preparation {
        claims: selected,
        accrued,
        ready: missing.values().all(|v| *v == 0),
    })
}

/// Native funding pages are owner-authorized and bounded independently of the
/// public market catalog. Parse atom strings exactly and retain only the fixed
/// receipt action surface; a query can never supply an arbitrary transaction.
pub fn funding_claims(s: &Value) -> Result<Vec<Claim>, String> {
    let entries = s["claims"]
        .as_array()
        .ok_or("Missing native funding claims")?;
    if entries.len() > PAGE_LIMIT {
        return Err("Native funding page exceeds bound".into());
    }
    let mut seen = BTreeSet::new();
    entries
        .iter()
        .map(|entry| {
            let method = entry["action"]["method"]
                .as_str()
                .ok_or("Missing native receipt method")?;
            if !["settle", "claim", "claimstop"].contains(&method) {
                return Err("Unsupported native receipt action".into());
            }
            let action = Action::new(method, entry["action"]["args"].clone())?;
            if !seen.insert(format!("{}:{}", action.method, action.args)) {
                return Err("Duplicate native receipt".into());
            }
            let raw = entry["payouts"]
                .as_object()
                .ok_or("Missing native receipt payouts")?;
            if raw.is_empty() || raw.len() > 2 {
                return Err("Invalid native receipt assets".into());
            }
            let mut payouts = Amounts::new();
            for (key, value) in raw {
                let token: u32 = key.parse().map_err(|_| "Invalid native receipt token")?;
                if key != &token.to_string() {
                    return Err("Invalid native receipt token".into());
                }
                let amount = number(value)?;
                if amount == 0 || amount > MAX_AMOUNT {
                    return Err("Invalid native receipt amount".into());
                }
                // AUTO_DEBIT determines where this receipt lands, so absent settings
                // must fail closed instead of silently treating it as shared funds.
                let row = balance(s, token).ok_or("Native receipt settings unavailable")?;
                if row["auto_debit"].as_bool().is_none() {
                    return Err("Native receipt settings unavailable".into());
                }
                payouts.insert(token, amount);
            }
            Ok(Claim { action, payouts })
        })
        .collect()
}

pub fn funds_ready(s: &Value, required: &Amounts) -> bool {
    required
        .iter()
        .all(|(&token, &amount)| shared(s, token) >= amount as u128)
}

/// A partial page is never evidence of global insufficiency. Even the final
/// page may be partially prepared, then freshly queried after confirmation.
/// Only an exhausted page with no useful receipts reports insufficient funds.
pub fn prepare_page(s: &Value, required: &Amounts, complete: bool) -> Result<Preparation, String> {
    if funds_ready(s, required) {
        return Ok(Preparation {
            claims: vec![],
            accrued: Amounts::new(),
            ready: true,
        });
    }
    let result = select(s, required, funding_claims(s)?, false)?;
    if complete && result.claims.is_empty() {
        return Err("Insufficient funds in the remaining scan; restart preparation to include newer proceeds, or deposit funds".into());
    }
    Ok(result)
}

#[derive(Debug)]
pub enum FundingStep {
    Transaction {
        preparation: Preparation,
        scanned: u64,
        complete: bool,
    },
    Scan {
        cursor: String,
        scanned: u64,
    },
}
/// This is a cursor advancement, not a financial confirmation. A selected
/// receipt batch always retains the input cursor, since its page may contain
/// additional unselected claims beyond MAX_CLAIMS.
pub fn funding_step(
    s: &Value,
    required: &Amounts,
    after: Option<&str>,
) -> Result<FundingStep, String> {
    page_cursor(after)?;
    let complete = s["complete"]
        .as_bool()
        .ok_or("Native funding completeness unavailable")?;
    let scanned = number(&s["scanned"])?;
    if scanned > PAGE_LIMIT as u64 {
        return Err("Native funding scan exceeds bound".into());
    }
    let next = match s.get("next_cursor") {
        None | Some(Value::Null) => None,
        Some(Value::String(cursor)) => Some(cursor.as_str()),
        _ => return Err("Invalid native funding continuation".into()),
    };
    page_cursor(next)?;
    if complete != next.is_none() {
        return Err("Inconsistent native funding continuation".into());
    }
    for &token in required.keys() {
        let row = balance(s, token).ok_or("Native funding balance unavailable")?;
        number(&row["incoming"])?;
        number(&row["outgoing"])?;
        if row["auto_debit"].as_bool().is_none() {
            return Err("Native funding settings unavailable".into());
        }
    }
    let preparation = prepare_page(s, required, complete)?;
    if preparation.claims.len() > scanned as usize {
        return Err("Native funding receipts exceed scan".into());
    }
    if !preparation.ready && preparation.claims.is_empty() {
        let cursor = next.ok_or("Native funding continuation unavailable")?;
        if Some(cursor) == after {
            return Err("Native funding scan did not advance".into());
        }
        return Ok(FundingStep::Scan {
            cursor: cursor.into(),
            scanned,
        });
    }
    Ok(FundingStep::Transaction {
        preparation,
        scanned,
        complete,
    })
}

pub fn page_cursor(cursor: Option<&str>) -> Result<(), String> {
    if cursor.is_some_and(|value| value.is_empty() || value.len() > MAX_CURSOR_BYTES) {
        return Err("Invalid page cursor".into());
    }
    Ok(())
}

/// Encode all cursor bytes, rather than interpreting an opaque cursor as query
/// syntax. Fixed routes accept no caller-selected owner or HTTP target.
pub fn query_escape(value: &str) -> String {
    value
        .bytes()
        .map(|byte| {
            if byte.is_ascii_alphanumeric() || b"-._~".contains(&byte) {
                (byte as char).to_string()
            } else {
                format!("%{byte:02X}")
            }
        })
        .collect()
}

pub fn position_key(
    kind: &str,
    market: &str,
    side: Option<bool>,
    price: Option<&str>,
) -> Result<String, String> {
    let market = number(&json!(market))?;
    if market == 0 {
        return Err("Market must be positive".into());
    }
    let mut endpoint = format!("/position?kind={kind}&market={market}");
    match kind {
        "orders" | "loans" => {
            let side = side.ok_or("Position side required")?;
            let price = number(&json!(price.ok_or("Position price required")?))?;
            if price == 0 {
                return Err("Position price must be positive".into());
            }
            endpoint += &format!("&side={side}&price={price}");
        }
        "lenders" => {
            let side = side.ok_or("Position side required")?;
            if price.is_some() {
                return Err("Unexpected position price".into());
            }
            endpoint += &format!("&side={side}");
        }
        "liquidity" => {
            if side.is_some() || price.is_some() {
                return Err("Unexpected position key".into());
            }
        }
        _ => return Err("Unsupported position kind".into()),
    }
    Ok(endpoint)
}

/// Re-credit only the fixed funding deficit. AUTO_DEBIT intentionally sends
/// all other settled proceeds to the primary wallet. This reduces prompts and
/// keeps live accrual from changing the reviewed transfer amount.
pub fn recredits(state: &Value, needed: &Amounts, accrued: &Amounts) -> Amounts {
    needed
        .iter()
        .filter_map(|(&token, &required)| {
            if !auto_debit(state, token) {
                return None;
            }
            let deficit = (required as u128)
                .saturating_sub(shared(state, token))
                .min(u64::MAX as u128) as u64;
            let keep = deficit.min(accrued.get(&token).copied().unwrap_or(0));
            (keep > 0).then_some((token, keep))
        })
        .collect()
}

/// An in-flight exact review is reusable only before publication attempt and within
/// its short expiry. User and active app are separately bound by the store key.
pub fn reusable_plan(
    sealed: bool,
    nonce: u64,
    consumed: u64,
    created: u64,
    now: u64,
    saved_request: &str,
    request: &str,
) -> bool {
    !sealed && nonce > consumed && saved_request == request && created <= now && now - created < 300
}

/// Publication callbacks receive only the actual signed sender/service pairs.
/// They cannot be invoked by the app to invalidate another pending plan.
pub fn publication_scope<'a>(
    publisher: &str,
    owner: &str,
    current_user: Option<&str>,
    saved_app: &str,
    current_app: &str,
    request: &str,
    ready: bool,
    actions: impl IntoIterator<Item = (&'a str, &'a str)>,
) -> Result<(), String> {
    if publisher != "transact" {
        return Err("Only native Transact may seal an Exchange plan".into());
    }
    expected_owner(owner, current_user)?;
    if saved_app != current_app {
        return Err("The requesting application changed before publication".into());
    }
    let withdrawal = if let Some(tail) = request.strip_prefix("withdraw:") {
        let (token, amount) = tail
            .split_once(':')
            .ok_or("Invalid pinned withdrawal request")?;
        let token: u32 = token
            .parse()
            .map_err(|_| "Invalid pinned withdrawal token")?;
        let amount: u64 = amount
            .parse()
            .map_err(|_| "Invalid pinned withdrawal amount")?;
        if amount == 0 || request != format!("withdraw:{token}:{amount}") {
            return Err("Invalid pinned withdrawal request".into());
        }
        true
    } else if request.starts_with("execute:") {
        false
    } else {
        return Err("Unknown pinned Exchange operation".into());
    };
    let mut exchange_actions = 0;
    let mut token_actions = 0;
    for (sender, service) in actions {
        if service == "tokens" {
            if sender != owner {
                return Err("Signed Tokens actions have another sender".into());
            }
            token_actions += 1;
        }
        if service == "exchange" {
            if sender != owner {
                return Err("Signed Exchange actions have another sender".into());
            }
            exchange_actions += 1;
        }
    }
    // A completed withdrawal may need only Tokens debit/uncredit. Tokens'
    // independent transfer hook enforces the exact token, quantity, Exchange
    // counterparty and consent; this hook receives sender/service scopes only.
    // Preparation-only calls still require actual Exchange receipt actions.
    if withdrawal && ready {
        if token_actions == 0 {
            return Err("No signed Tokens withdrawal to seal".into());
        }
    } else if exchange_actions == 0 {
        return Err("No signed Exchange operation to seal".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn state() -> Value {
        json!({"owner":"alice","markets":[{"id":"1","base":1,"quote":2,"base_lot":"1000","quote_tick":"10","lp_supply":"10000","x":"20000","y":"30000","escrow_base":{"funded":true},"escrow_quote":{"funded":true}}],"balances":[{"token":1,"incoming":"4","outgoing":"6","auto_debit":false},{"token":2,"incoming":"0","outgoing":"0","auto_debit":true}],"positions":[],"loan_positions":[],"loans":[],"stop_positions":[]})
    }
    fn action(method: &str, args: Value) -> Action {
        Action::new(method, args).unwrap()
    }
    fn position(price: u64, proceeds: u64) -> Value {
        json!({"owner":"alice","market":"1","bid":false,"price":price.to_string(),"proceeds":proceeds.to_string()})
    }
    #[test]
    fn accepts_integer_strings_without_precision_loss() {
        let a = action("cancelstop", json!({"generation":"18446744073709551615"}));
        assert_eq!(a.number("generation"), u64::MAX);
        for v in [
            json!("18446744073709551616"),
            json!("+2"),
            json!("1.0"),
            json!(-1),
            json!(2.1),
            json!(null),
        ] {
            assert!(number(&v).is_err());
        }
    }
    #[test]
    fn no_foreign_target_or_unsafe_action() {
        for method in ["init", "snapshot", "serveSys", "setUserConf", ""] {
            assert!(Action::new(method, json!({})).is_err());
        }
        assert!(Action::new(
            "cancel",
            json!({"owner":"bob","market":1,"bid":true,"price":2})
        )
        .is_err());
        assert!(Action::new(
            "trade",
            json!({"market":1,"sell_base":true,"amount":1,"min_output":0,"max_events":257})
        )
        .is_err());
        assert!(Action::new("limit", json!({"market":1,"bid":1,"amount":1,"price":2})).is_err());
        assert!(Action::new(
            "limit",
            json!({"market":1,"bid":true,"amount":MAX_AMOUNT+1,"price":2})
        )
        .is_err());
    }
    #[test]
    fn required_inputs_use_exact_native_formulas() {
        let s = state();
        assert_eq!(
            required(
                &s,
                &action(
                    "borrow",
                    json!({"market":1,"long":true,"price":20,"units":3})
                )
            )
            .unwrap(),
            Amounts::from([(1, 6000)])
        );
        assert_eq!(
            required(
                &s,
                &action(
                    "borrow",
                    json!({"market":1,"long":false,"price":20,"units":3})
                )
            )
            .unwrap(),
            Amounts::from([(2, 1200)])
        );
        assert_eq!(
            required(
                &s,
                &action(
                    "repay",
                    json!({"market":1,"long":true,"price":20,"units":3})
                )
            )
            .unwrap(),
            Amounts::from([(2, 600)])
        );
        assert_eq!(
            required(
                &s,
                &action(
                    "repay",
                    json!({"market":1,"long":false,"price":20,"units":3})
                )
            )
            .unwrap(),
            Amounts::from([(1, 3000)])
        );
        assert_eq!(
            required(&s, &action("addliq", json!({"market":1,"shares":3}))).unwrap(),
            Amounts::from([(1, 6), (2, 9)])
        );
    }
    #[test]
    fn borrow_overflow_and_face_cap_rejected() {
        let mut s = state();
        s["markets"][0]["quote_tick"] = json!(u64::MAX);
        let a = action(
            "borrow",
            json!({"market":1,"long":true,"price":u64::MAX,"units":MAX_AMOUNT}),
        );
        assert!(required(&s, &a).is_err());
    }
    #[test]
    fn ready_funds_skip_all_receipts() {
        let mut s = state();
        s["positions"] = json!([position(1, 100)]);
        let p = prepare(&s, &Amounts::from([(1, 10)])).unwrap();
        assert!(p.ready);
        assert!(p.claims.is_empty());
    }
    #[test]
    fn selects_only_needed_token_but_retains_both_stop_assets() {
        let mut s = state();
        s["positions"] = json!([
            position(1, 25),
            json!({"owner":"alice","market":1,"bid":true,"price":2,"proceeds":"999"})
        ]);
        s["stop_positions"] = json!([{"owner":"alice","market":1,"generation":"9","sell_base":false,"status":"partially_filled","claimable_input":"5","claimable_output":"7"}]);
        let p = prepare(&s, &Amounts::from([(2, 28)])).unwrap();
        assert!(p.ready);
        assert_eq!(p.claims.len(), 2);
        assert_eq!(p.accrued, Amounts::from([(1, 7), (2, 30)]));
    }
    #[test]
    fn rejects_foreign_unfunded_and_unavailable_receipts() {
        let mut s = state();
        let mut foreign = position(1, 20);
        foreign["owner"] = json!("bob");
        s["positions"] = json!([foreign]);
        assert!(prepare(&s, &Amounts::from([(2, 1)])).is_err());
        s["positions"] = json!([position(1, 20)]);
        s["markets"][0]["escrow_quote"]["funded"] = json!(false);
        assert!(prepare(&s, &Amounts::from([(2, 1)])).is_err());
        s["markets"][0]["escrow_quote"]["funded"] = json!(true);
        s["stop_positions"] = json!([{"owner":"alice","market":1,"generation":9,"sell_base":false,"status":"armed","claimable_input":"500","claimable_output":"7"}]);
        assert!(prepare(&s, &Amounts::from([(2, 21)])).is_err());
    }
    #[test]
    fn bounded_preparation_then_fresh_snapshot_completes() {
        let mut s = state();
        s["positions"] = Value::Array((1..=40).map(|p| position(p, 1)).collect());
        let p = prepare(&s, &Amounts::from([(2, 40)])).unwrap();
        assert!(!p.ready);
        assert_eq!(p.claims.len(), 32);
        assert_eq!(p.accrued[&2], 32);
        s["positions"] = Value::Array((33..=40).map(|p| position(p, 1)).collect());
        s["balances"][1]["outgoing"] = json!("32");
        let p = prepare(&s, &Amounts::from([(2, 40)])).unwrap();
        assert!(p.ready);
        assert_eq!(p.claims.len(), 8);
        assert!(auto_debit(&s, 2));
    }
    #[test]
    fn exact_loan_claims_only_and_no_repay_of_live_loans() {
        let mut s = state();
        s["loan_positions"] =
            json!([{"owner":"alice","market":1,"long":true,"price":20,"units":3,"generation":4}]);
        s["loans"] = json!([{"generation":4,"active":false,"claimable_surplus":"15"}]);
        let p = prepare(&s, &Amounts::from([(2, 15)])).unwrap();
        assert!(p.ready);
        assert_eq!(p.claims[0].action.method, "claim");
        s["loans"][0]["active"] = json!(true);
        assert!(prepare(&s, &Amounts::from([(2, 1)])).is_err());
    }
    #[test]
    fn duplicate_asset_create_and_unknown_markets_rejected() {
        assert!(required(&state(),&action("create",json!({"base":1,"quote":1,"base_amount":1000,"quote_amount":2000,"base_lot":100,"quote_tick":1}))).is_err());
        assert!(required(
            &state(),
            &action(
                "trade",
                json!({"market":99,"sell_base":true,"amount":1,"min_output":0,"max_events":1})
            )
        )
        .is_err());
    }
    #[test]
    fn recredits_only_fixed_needed_deficit_not_all_live_accrual() {
        let s = state();
        assert_eq!(
            recredits(
                &s,
                &Amounts::from([(2, 10)]),
                &Amounts::from([(1, 100), (2, 1000)])
            ),
            Amounts::from([(2, 10)])
        );
        assert_eq!(
            recredits(&s, &Amounts::from([(2, 100)]), &Amounts::from([(2, 20)])),
            Amounts::from([(2, 20)])
        );
        assert!(recredits(&s, &Amounts::from([(1, 20)]), &Amounts::from([(1, 100)])).is_empty());
    }
    #[test]
    fn pending_plan_expires_and_cannot_reuse_a_native_commit() {
        assert!(reusable_plan(
            false,
            2,
            1,
            100,
            399,
            "fixed-action",
            "fixed-action"
        ));
        assert!(!reusable_plan(
            false,
            2,
            1,
            100,
            400,
            "fixed-action",
            "fixed-action"
        ));
        assert!(!reusable_plan(
            false,
            2,
            2,
            100,
            150,
            "fixed-action",
            "fixed-action"
        ));
        assert!(!reusable_plan(
            false,
            2,
            1,
            100,
            99,
            "fixed-action",
            "fixed-action"
        ));
        assert!(!reusable_plan(
            false,
            2,
            1,
            100,
            150,
            "fixed-action",
            "changed-action"
        ));
    }
    #[test]
    fn expected_owner_rejects_stale_tabs_and_cannot_select_identity() {
        assert!(expected_owner("alice", Some("alice")).is_ok());
        assert!(expected_owner("alice", Some("bob")).is_err());
        assert!(expected_owner("alice", None).is_err());
        assert!(expected_owner("", Some("")).is_err());
    }
    #[test]
    fn client_action_matches_native_trade_schema_and_amount_bound() {
        let native = exchange::action_structs::trade {
            market: 1,
            sell_base: true,
            amount: 100,
            min_output: 95,
            max_events: 128,
        };
        let args = serde_json::to_value(native).unwrap();
        let a = Action::new("trade", args).unwrap();
        assert_eq!(a.number("min_output"), 95);
        assert_eq!(MAX_AMOUNT, exchange::math::MAX);
    }
    #[test]
    fn unknown_and_rejected_submission_never_resurrect_a_sealed_plan() {
        // This flag is persisted before native RPC. Transactional storage may
        // roll back after either rejection or lost response; sealing survives.
        for consumed in [0, 2] {
            assert!(!reusable_plan(true, 2, consumed, 100, 101, "same", "same"));
        }
        // Transfer/signing prompts abort before the publication callback.
        assert!(reusable_plan(false, 2, 0, 100, 101, "same", "same"));
    }
    #[test]
    fn only_publisher_can_seal_actual_owner_actions_in_the_same_app() {
        let actions = [("alice", "exchange"), ("alice", "tokens")];
        assert!(publication_scope(
            "transact",
            "alice",
            Some("alice"),
            "exchange",
            "exchange",
            "execute:trade:{}",
            true,
            actions
        )
        .is_ok());
        for publisher in ["exchange", "tokens", "supervisor", "evil"] {
            assert!(publication_scope(
                publisher,
                "alice",
                Some("alice"),
                "exchange",
                "exchange",
                "execute:trade:{}",
                true,
                actions
            )
            .is_err());
        }
        assert!(publication_scope(
            "transact",
            "alice",
            Some("bob"),
            "exchange",
            "exchange",
            "execute:trade:{}",
            true,
            actions
        )
        .is_err());
        assert!(publication_scope(
            "transact",
            "alice",
            Some("alice"),
            "exchange",
            "evil",
            "execute:trade:{}",
            true,
            actions
        )
        .is_err());
        for actions in [[("bob", "exchange")], [("alice", "tokens")]] {
            assert!(publication_scope(
                "transact",
                "alice",
                Some("alice"),
                "exchange",
                "exchange",
                "execute:trade:{}",
                true,
                actions
            )
            .is_err());
        }
    }
    #[test]
    fn ready_withdrawal_can_seal_tokens_only_without_weakening_execute_or_preparation() {
        let tokens = [("alice", "tokens")];
        assert!(publication_scope(
            "transact",
            "alice",
            Some("alice"),
            "exchange",
            "exchange",
            "withdraw:2:9845",
            true,
            tokens
        )
        .is_ok());
        assert!(publication_scope(
            "transact",
            "alice",
            Some("alice"),
            "exchange",
            "exchange",
            "execute:cancel:{}",
            true,
            tokens
        )
        .is_err());
        assert!(publication_scope(
            "transact",
            "alice",
            Some("alice"),
            "exchange",
            "exchange",
            "withdraw:2:9845",
            false,
            tokens
        )
        .is_err());
        let receipts = [("alice", "exchange")];
        assert!(publication_scope(
            "transact",
            "alice",
            Some("alice"),
            "exchange",
            "exchange",
            "withdraw:2:9845",
            false,
            receipts
        )
        .is_ok());
        assert!(publication_scope(
            "transact",
            "alice",
            Some("alice"),
            "exchange",
            "exchange",
            "withdraw:2:9845",
            true,
            receipts
        )
        .is_err());
    }
    #[test]
    fn withdrawal_publication_keeps_owner_and_canonical_token_amount_request_bound() {
        for request in [
            "withdraw:2:0",
            "withdraw:2:9845:extra",
            "withdraw:4294967296:1",
            "withdraw:2:-1",
            "withdraw:02:9845",
            "unknown",
        ] {
            assert!(publication_scope(
                "transact",
                "alice",
                Some("alice"),
                "exchange",
                "exchange",
                request,
                true,
                [("alice", "tokens")]
            )
            .is_err());
        }
        for scopes in [
            [("bob", "tokens"), ("alice", "exchange")],
            [("alice", "tokens"), ("bob", "exchange")],
        ] {
            assert!(publication_scope(
                "transact",
                "alice",
                Some("alice"),
                "exchange",
                "exchange",
                "withdraw:2:9845",
                true,
                scopes
            )
            .is_err());
        }
    }
    fn funding_page(entries: Vec<Value>, complete: bool) -> Value {
        json!({"owner":"alice","balances":[
            {"token":1,"incoming":"0","outgoing":"0","auto_debit":false},
            {"token":2,"incoming":"0","outgoing":"0","auto_debit":true}
        ],"claims":entries,"scanned":200,"complete":complete,
        "next_cursor":if complete {Value::Null} else {json!("p1.6c617465")}})
    }
    fn funding_entry(price: u64, amount: u64) -> Value {
        json!({"action":{"method":"settle","args":{"market":"101","bid":false,"price":price.to_string()}},"payouts":{"2":amount.to_string()}})
    }
    #[test]
    fn point_market_beyond_catalog_and_arbitrary_create_assets_work() {
        let mut s = state();
        s["markets"][0]["id"] = json!("101");
        assert_eq!(
            required(
                &s,
                &action(
                    "limit",
                    json!({"market":"101","bid":true,"price":10,"amount":50})
                )
            )
            .unwrap(),
            Amounts::from([(2, 50)])
        );
        assert_eq!(required(&json!({}),&action("create",json!({"base":4000000,"quote":4294967295u32,"base_amount":10,"quote_amount":20,"base_lot":1,"quote_tick":1}))).unwrap(), Amounts::from([(4000000,10),(u32::MAX,20)]));
        let s = json!({"balances":[{"token":4000000,"incoming":"11","outgoing":"22","auto_debit":false}]});
        assert!(funds_ready(&s, &Amounts::from([(4000000, 33)])));
        assert!(!funds_ready(&s, &Amounts::from([(4000000, 34)])));
    }
    #[test]
    fn empty_prefix_advances_without_financial_transaction_and_late_claim_executes() {
        let required = Amounts::from([(2, 50)]);
        let prefix = funding_page(vec![], false);
        let cursor = match funding_step(&prefix, &required, None).unwrap() {
            FundingStep::Scan { cursor, scanned } => {
                assert_eq!(scanned, 200);
                cursor
            }
            _ => panic!("an empty prefix cannot submit preparation"),
        };
        let late = funding_page(vec![funding_entry(9001, 50)], true);
        match funding_step(&late, &required, Some(&cursor)).unwrap() {
            FundingStep::Transaction {
                preparation,
                complete,
                ..
            } => {
                assert!(complete);
                assert!(preparation.ready);
                assert_eq!(preparation.claims[0].action.number("market"), 101);
            }
            _ => panic!("late claims must be usable"),
        }
        assert!(
            funding_step(&funding_page(vec![], true), &required, Some(&cursor))
                .unwrap_err()
                .contains("remaining scan")
        );
    }
    #[test]
    fn partial_and_final_pages_prepare_useful_funds_without_false_insufficiency() {
        for complete in [false, true] {
            let page = funding_page(vec![funding_entry(1, 10)], complete);
            match funding_step(&page, &Amounts::from([(2, 50)]), None).unwrap() {
                FundingStep::Transaction { preparation, .. } => {
                    assert!(!preparation.ready);
                    assert_eq!(preparation.claims.len(), 1);
                    assert_eq!(preparation.accrued, Amounts::from([(2, 10)]));
                }
                _ => panic!("useful funds must be prepared"),
            }
        }
    }
    #[test]
    fn bounded_batch_keeps_unselected_receipts_reachable_from_same_cursor() {
        let required = Amounts::from([(2, 40)]);
        let mut page = funding_page(
            (1..=40).map(|price| funding_entry(price, 1)).collect(),
            false,
        );
        let first = match funding_step(&page, &required, Some("p1.7374617274")).unwrap() {
            FundingStep::Transaction { preparation, .. } => preparation,
            _ => panic!(),
        };
        assert_eq!(first.claims.len(), MAX_CLAIMS);
        assert!(!first.ready);
        // The caller retains the input cursor after confirmation and refreshes
        // the same page. Removing only the claimed rows exposes the remaining 8.
        page["claims"] = json!((33..=40)
            .map(|price| funding_entry(price, 1))
            .collect::<Vec<_>>());
        page["balances"][1]["outgoing"] = json!("32");
        let second = match funding_step(&page, &required, Some("p1.7374617274")).unwrap() {
            FundingStep::Transaction { preparation, .. } => preparation,
            _ => panic!(),
        };
        assert!(second.ready);
        assert_eq!(second.claims.len(), 8);
    }
    #[test]
    fn normalized_funding_retains_both_stop_assets_and_exact_atom_strings() {
        let entry = json!({"action":{"method":"claimstop","args":{"generation":"18446744073709551615"}},"payouts":{"1":"3","2":"50"}});
        let page = funding_page(vec![entry], true);
        let p = prepare_page(&page, &Amounts::from([(2, 50)]), true).unwrap();
        assert!(p.ready);
        assert_eq!(p.accrued, Amounts::from([(1, 3), (2, 50)]));
        assert_eq!(p.claims[0].action.number("generation"), u64::MAX);
    }
    #[test]
    fn normalized_claims_reject_arbitrary_calls_duplicates_bad_amounts_and_missing_flags() {
        let good = funding_entry(1, 50);
        for bad in [
            json!({"action":{"method":"trade","args":{"market":1,"sell_base":true,"amount":1,"min_output":0,"max_events":0}},"payouts":{"2":"50"}}),
            json!({"action":{"method":"settle","args":{"market":1,"bid":false,"price":1,"owner":"bob"}},"payouts":{"2":"50"}}),
            json!({"action":{"method":"settle","args":{"market":1,"bid":false,"price":1}},"payouts":{"02":"50"}}),
            json!({"action":{"method":"settle","args":{"market":1,"bid":false,"price":1}},"payouts":{"2":"+50"}}),
            json!({"action":{"method":"settle","args":{"market":1,"bid":false,"price":1}},"payouts":{"2":"18446744073709551616"}}),
            json!({"action":{"method":"settle","args":{"market":1,"bid":false,"price":1}},"payouts":{"2":"0"}}),
        ] {
            assert!(funding_claims(&funding_page(vec![bad], true)).is_err());
        }
        assert!(funding_claims(&funding_page(vec![good.clone(), good.clone()], true)).is_err());
        let mut page = funding_page(vec![good], true);
        page["balances"][1]["auto_debit"] = Value::Null;
        assert!(funding_claims(&page).is_err());
    }
    #[test]
    fn malformed_or_nonadvancing_funding_pages_fail_closed() {
        let required = Amounts::from([(2, 50)]);
        for (key, value) in [
            ("scanned", json!(201)),
            ("complete", json!(true)),
            ("next_cursor", json!(12)),
            ("next_cursor", json!("")),
            ("next_cursor", json!("x".repeat(MAX_CURSOR_BYTES + 1))),
        ] {
            let mut page = funding_page(vec![], false);
            page[key] = value;
            assert!(funding_step(&page, &required, None).is_err());
        }
        assert!(
            funding_step(&funding_page(vec![], false), &required, Some("p1.6c617465")).is_err()
        );
        let mut page = funding_page(vec![funding_entry(1, 50)], true);
        page["scanned"] = json!(0);
        assert!(funding_step(&page, &required, None).is_err());
        assert!(funding_claims(&funding_page(
            (1..=201).map(|i| funding_entry(i, 1)).collect(),
            false
        ))
        .is_err());
    }
    #[test]
    fn position_points_require_exact_family_keys_and_escape_opaque_cursors() {
        assert_eq!(
            position_key("orders", "101", Some(true), Some("42")).unwrap(),
            "/position?kind=orders&market=101&side=true&price=42"
        );
        assert_eq!(
            position_key("liquidity", "101", None, None).unwrap(),
            "/position?kind=liquidity&market=101"
        );
        for (kind, side, price) in [
            ("orders", None, Some("1")),
            ("loans", Some(false), None),
            ("lenders", Some(true), Some("1")),
            ("liquidity", Some(false), None),
            ("unknown", None, None),
        ] {
            assert!(position_key(kind, "101", side, price).is_err());
        }
        assert!(position_key("orders", "0", Some(true), Some("1")).is_err());
        assert!(position_key("orders", "101", Some(true), Some("0")).is_err());
        assert_eq!(query_escape("p1.a&owner=bob#%"), "p1.a%26owner%3Dbob%23%25");
        assert!(page_cursor(Some("")).is_err());
    }
}
