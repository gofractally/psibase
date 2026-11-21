//! Bounded native seek pages. Cursors bind owner, kind and filters; no offsets,
//! global token catalog scans, or silent market/portfolio truncation.
use crate::{snapshot as view, tables::tables::*};
use psibase::{AccountNumber, Table};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, BTreeSet},
    ops::Bound::{Excluded, Included, Unbounded},
};
pub const MAX_PAGE: u32 = 200;
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Cursor {
    v: u8,
    owner: String,
    kind: String,
    filter: Option<u64>,
    tokens: Vec<u32>,
    key: Vec<u64>,
}
fn encode(c: &Cursor) -> String {
    let bytes = serde_json::to_vec(c).unwrap();
    let mut out = String::from("p1.");
    for b in bytes {
        out.push_str(&format!("{b:02x}"));
    }
    out
}
fn cursor(
    after: Option<&str>,
    owner: Option<AccountNumber>,
    kind: &str,
    filter: Option<u64>,
    tokens: &[u32],
) -> Result<Option<Cursor>, String> {
    let Some(after) = after else { return Ok(None) };
    let text = after.strip_prefix("p1.").ok_or("Invalid page cursor")?;
    if text.is_empty()
        || text.len() > 2048
        || text.len() % 2 != 0
        || !text
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err("Invalid page cursor".into());
    }
    let bytes: Vec<u8> = (0..text.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&text[i..i + 2], 16).unwrap())
        .collect();
    let c: Cursor = serde_json::from_slice(&bytes).map_err(|_| "Invalid page cursor")?;
    if c.v != 1
        || c.owner != owner.map(|a| a.to_string()).unwrap_or_default()
        || c.kind != kind
        || c.filter != filter
        || c.tokens != tokens
        || encode(&c) != after
    {
        return Err("Page cursor scope mismatch".into());
    }
    Ok(Some(c))
}
fn next(
    owner: Option<AccountNumber>,
    kind: &str,
    filter: Option<u64>,
    tokens: &[u32],
    key: Vec<u64>,
) -> String {
    encode(&Cursor {
        v: 1,
        owner: owner.map(|a| a.to_string()).unwrap_or_default(),
        kind: kind.into(),
        filter,
        tokens: tokens.into(),
        key,
    })
}
fn checked_limit(limit: u32) -> Result<usize, String> {
    if !(1..=MAX_PAGE).contains(&limit) {
        Err("Page limit must be 1 to 200".into())
    } else {
        Ok(limit as usize)
    }
}
pub fn text(mut v: Value) -> String {
    view::preserve_integers(&mut v);
    v.to_string()
}
fn n(v: &Value) -> u64 {
    v.as_u64()
        .or_else(|| v.as_str()?.parse().ok())
        .expect("native unsigned integer")
}
fn key3(c: Option<&Cursor>, filter: Option<u64>) -> Result<Option<(u64, bool, u64)>, String> {
    let Some(c) = c else { return Ok(None) };
    if c.key.len() != 3 || c.key[1] > 1 || filter.is_some_and(|m| m != c.key[0]) {
        return Err("Invalid position cursor key".into());
    }
    Ok(Some((c.key[0], c.key[1] != 0, c.key[2])))
}
pub(crate) fn market_view(m: &Market, native: bool) -> Value {
    json!({"id":m.id,"base":m.base,"quote":m.quote,"base_lot":m.base_lot,"quote_tick":m.quote_tick,"x":m.x,"y":m.y,"k":m.k.to_string(),"lp_supply":m.lp_supply,"vault_base":m.vault_base,"vault_quote":m.vault_quote,"debt_base":m.debt_base,"debt_quote":m.debt_quote,"lending_base":m.lending_base,"lending_quote":m.lending_quote,"maturity":m.maturity,"margin_enabled":m.margin_enabled==Some(true),"legacy_unsupported":m.margin_enabled.is_none(),"escrow_base":view::escrow_view(m.id,m.base,native),"escrow_quote":view::escrow_view(m.id,m.quote,native)})
}
fn market(id: u64) -> Result<Market, String> {
    MarketTable::with_service(crate::SERVICE)
        .get_index_pk()
        .get(&id)
        .ok_or_else(|| "Unknown market".into())
}
fn metadata(ids: impl IntoIterator<Item = u32>, native: bool) -> Vec<Value> {
    if !native {
        return vec![];
    };
    let table = view::foreign::<_, tokens::tables::tables::TokenTable>(tokens::SERVICE);
    ids.into_iter()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .filter_map(|id| table.get_index_pk().get(&id))
        .map(|t| view::metadata(&t))
        .collect()
}
pub(crate) fn related(
    ids: impl IntoIterator<Item = u64>,
    native: bool,
) -> Result<(Vec<Value>, Vec<Value>), String> {
    let mut ms = vec![];
    let mut tokens = BTreeSet::new();
    for id in ids.into_iter().collect::<BTreeSet<_>>() {
        let m = market(id)?;
        tokens.extend([m.base, m.quote]);
        ms.push(market_view(&m, native));
    }
    Ok((ms, metadata(tokens, native)))
}
pub fn market_point(id: u64, native: bool) -> Result<Value, String> {
    let m = market(id)?;
    Ok(json!({"market":market_view(&m,native),"tokens":metadata([m.base,m.quote],native)}))
}
pub fn markets(after: u64, limit: u32, native: bool) -> Result<Value, String> {
    let limit = checked_limit(limit)?;
    let mut rows: Vec<_> = MarketTable::with_service(crate::SERVICE)
        .get_index_pk()
        .range((Excluded(after), Unbounded))
        .take(limit + 1)
        .collect();
    let more = rows.len() > limit;
    rows.truncate(limit);
    let next = more.then(|| rows.last().unwrap().id.to_string());
    let tokens = metadata(rows.iter().flat_map(|m| [m.base, m.quote]), native);
    Ok(
        json!({"markets":rows.iter().map(|m|market_view(m,native)).collect::<Vec<_>>(),"tokens":tokens,"levels":[],"next_after":next}),
    )
}
pub fn book(id: u64, bid: bool, after: Option<&str>, limit: u32) -> Result<Value, String> {
    market(id)?;
    let limit = checked_limit(limit)?;
    let kind = if bid { "book-bid" } else { "book-ask" };
    let c = cursor(after, None, kind, Some(id), &[])?;
    if c.as_ref().is_some_and(|c| c.key.len() != 1) {
        return Err("Invalid book cursor key".into());
    }
    let lower = c
        .as_ref()
        .map(|c| Excluded((id, bid, c.key[0])))
        .unwrap_or(Included((id, bid, 0)));
    let mut rows: Vec<_> = BookTable::with_service(crate::SERVICE)
        .get_index_pk()
        .range((lower, Included((id, bid, u64::MAX))))
        .take(limit + 1)
        .collect();
    let more = rows.len() > limit;
    rows.truncate(limit);
    let after = more.then(|| {
        next(
            None,
            kind,
            Some(id),
            &[],
            vec![rows.last().unwrap().priority],
        )
    });
    let levels:Vec<_>=rows.iter().map(|b|{let p=PoolTable::with_service(crate::SERVICE).get_index_pk().get(&b.generation).expect("book generation");json!({"market":p.market,"bid":p.bid,"price":p.price,"outgoing":p.outgoing,"active":p.active})}).collect();
    Ok(json!({"market":id,"bid":bid,"levels":levels,"next_after":after}))
}
fn maker(p: &Maker) -> Value {
    let g = PoolTable::with_service(crate::SERVICE)
        .get_index_pk()
        .get(&p.generation)
        .expect("maker generation");
    let m = market(p.market).expect("maker market");
    view::order_view(p, &g, &m)
}
fn borrower(p: &Borrower) -> (Value, Value) {
    let g = LoanTable::with_service(crate::SERVICE)
        .get_index_pk()
        .get(&p.generation)
        .expect("loan generation");
    let loan = view::loan_view(p, &g);
    let mut row = serde_json::to_value(p).unwrap();
    for (k, v) in loan.as_object().unwrap() {
        row[k] = v.clone();
    }
    (row, loan)
}
fn position_result(
    owner: AccountNumber,
    kind: &str,
    filter: Option<u64>,
    rows: Vec<Value>,
    loans: Vec<Value>,
    after: Option<String>,
    native: bool,
) -> Result<Value, String> {
    let (ms, tokens) = related(rows.iter().map(|r| n(&r["market"])), native)?;
    let mut result = json!({"owner":owner,"kind":kind,"market":filter,"rows":rows,"markets":ms,"tokens":tokens,"next_after":after});
    let field = match kind {
        "orders" => "positions",
        "loans" => "loan_positions",
        "lenders" => "lenders",
        "liquidity" => "relay_shares",
        _ => return Err("Invalid position kind".into()),
    };
    result[field] = result["rows"].clone();
    if kind == "loans" {
        result["loans"] = json!(loans);
    }
    Ok(result)
}
pub fn positions(
    owner: AccountNumber,
    kind: &str,
    filter: Option<u64>,
    after: Option<&str>,
    limit: u32,
    native: bool,
) -> Result<Value, String> {
    let limit = checked_limit(limit)?;
    if let Some(m) = filter {
        market(m)?;
    }
    let c = cursor(after, Some(owner), kind, filter, &[])?;
    let (lo, hi) = (filter.unwrap_or(0), filter.unwrap_or(u64::MAX));
    let mut rows = vec![];
    let mut loans = vec![];
    let mut keys = vec![];
    match kind {
        "orders" => {
            let last = key3(c.as_ref(), filter)?;
            let lower = last
                .map(|(m, s, p)| Excluded((owner, m, s, p)))
                .unwrap_or(Included((owner, lo, false, 0)));
            for p in MakerTable::with_service(crate::SERVICE)
                .get_index_pk()
                .range((lower, Included((owner, hi, true, u64::MAX))))
                .take(limit + 1)
            {
                keys.push(vec![p.market, p.bid as u64, p.price]);
                rows.push(maker(&p));
            }
        }
        "loans" => {
            let last = key3(c.as_ref(), filter)?;
            let lower = last
                .map(|(m, s, p)| Excluded((owner, m, s, p)))
                .unwrap_or(Included((owner, lo, false, 0)));
            for p in BorrowerTable::with_service(crate::SERVICE)
                .get_index_pk()
                .range((lower, Included((owner, hi, true, u64::MAX))))
                .take(limit + 1)
            {
                keys.push(vec![p.market, p.long as u64, p.price]);
                let (row, loan) = borrower(&p);
                rows.push(row);
                loans.push(loan);
            }
        }
        "lenders" => {
            if c.as_ref().is_some_and(|c| {
                c.key.len() != 2 || c.key[1] > 1 || filter.is_some_and(|m| m != c.key[0])
            }) {
                return Err("Invalid lender cursor key".into());
            }
            let lower = c
                .as_ref()
                .map(|c| Excluded((owner, c.key[0], c.key[1] != 0)))
                .unwrap_or(Included((owner, lo, false)));
            for p in LenderTable::with_service(crate::SERVICE)
                .get_index_pk()
                .range((lower, Included((owner, hi, true))))
                .take(limit + 1)
            {
                keys.push(vec![p.market, p.base as u64]);
                rows.push(json!(p));
            }
        }
        "liquidity" => {
            if c.as_ref()
                .is_some_and(|c| c.key.len() != 1 || filter.is_some_and(|m| m != c.key[0]))
            {
                return Err("Invalid liquidity cursor key".into());
            }
            let lower = c
                .as_ref()
                .map(|c| Excluded((owner, c.key[0])))
                .unwrap_or(Included((owner, lo)));
            for p in LiquidityTable::with_service(crate::SERVICE)
                .get_index_pk()
                .range((lower, Included((owner, hi))))
                .take(limit + 1)
            {
                keys.push(vec![p.market]);
                rows.push(json!(p));
            }
        }
        _ => return Err("Invalid position kind".into()),
    }
    let more = rows.len() > limit;
    rows.truncate(limit);
    loans.truncate(limit);
    let after = more.then(|| next(Some(owner), kind, filter, &[], keys[limit - 1].clone()));
    position_result(owner, kind, filter, rows, loans, after, native)
}
pub fn position(
    owner: AccountNumber,
    kind: &str,
    m: u64,
    side: Option<bool>,
    price: Option<u64>,
    native: bool,
) -> Result<Value, String> {
    market(m)?;
    let mut rows = vec![];
    let mut loans = vec![];
    match kind {
        "orders" => {
            let key = (
                owner,
                m,
                side.ok_or("Order side required")?,
                price.ok_or("Order price required")?,
            );
            if let Some(p) = MakerTable::with_service(crate::SERVICE)
                .get_index_pk()
                .get(&key)
            {
                rows.push(maker(&p));
            }
        }
        "loans" => {
            let key = (
                owner,
                m,
                side.ok_or("Loan side required")?,
                price.ok_or("Loan price required")?,
            );
            if let Some(p) = BorrowerTable::with_service(crate::SERVICE)
                .get_index_pk()
                .get(&key)
            {
                let (row, loan) = borrower(&p);
                rows.push(row);
                loans.push(loan);
            }
        }
        "lenders" => {
            if price.is_some() {
                return Err("Unexpected lender price".into());
            }
            if let Some(p) = LenderTable::with_service(crate::SERVICE)
                .get_index_pk()
                .get(&(owner, m, side.ok_or("Lender side required")?))
            {
                rows.push(json!(p));
            }
        }
        "liquidity" => {
            if side.is_some() || price.is_some() {
                return Err("Unexpected liquidity key".into());
            }
            if let Some(p) = LiquidityTable::with_service(crate::SERVICE)
                .get_index_pk()
                .get(&(owner, m))
            {
                rows.push(json!(p));
            }
        }
        _ => return Err("Invalid position kind".into()),
    };
    position_result(owner, kind, Some(m), rows, loans, None, native)
}
pub fn balance(owner: AccountNumber, token: u32) -> Result<(Value, Value), String> {
    use tokens::tables::tables::{
        BalanceConfigTable, BalanceTable, SharedBalanceTable, TokenTable, UserConfigTable,
    };
    let t = view::foreign::<_, TokenTable>(tokens::SERVICE)
        .get_index_pk()
        .get(&token)
        .ok_or("Unknown token")?;
    let shared = view::foreign::<_, SharedBalanceTable>(tokens::SERVICE);
    let outgoing = shared
        .get_index_by_creditor_debitor_token()
        .get(&(owner, crate::SERVICE, token))
        .map(|r| r.balance.value)
        .unwrap_or(0);
    let incoming = shared
        .get_index_by_creditor_debitor_token()
        .get(&(crate::SERVICE, owner, token))
        .map(|r| r.balance.value)
        .unwrap_or(0);
    let wallet = view::foreign::<_, BalanceTable>(tokens::SERVICE)
        .get_index_pk()
        .get(&(owner, token))
        .map(|r| r.balance.value)
        .unwrap_or(0);
    let flags = view::foreign::<_, BalanceConfigTable>(tokens::SERVICE)
        .get_index_pk()
        .get(&(owner, token))
        .map(|r| r.flags)
        .unwrap_or_else(|| {
            view::foreign::<_, UserConfigTable>(tokens::SERVICE)
                .get_index_pk()
                .get(&owner)
                .map(|r| r.flags)
                .unwrap_or(0)
        });
    Ok((
        json!({"token":token,"wallet":view::integer(wallet as u128),"incoming":view::integer(incoming as u128),"outgoing":view::integer(outgoing as u128),"spendable":view::integer(incoming as u128+outgoing as u128),"auto_debit":flags&1!=0}),
        view::metadata(&t),
    ))
}
pub fn asset(owner: AccountNumber, token: u32) -> Result<Value, String> {
    let (row, meta) = balance(owner, token)?;
    Ok(json!({"owner":owner,"balance":row,"token":meta,"balances":[row],"tokens":[meta]}))
}
pub fn assets(owner: AccountNumber, after: Option<&str>, limit: u32) -> Result<Value, String> {
    let limit = checked_limit(limit)?;
    let c = cursor(after, Some(owner), "assets", None, &[])?;
    if c.as_ref()
        .is_some_and(|c| c.key.len() != 1 || c.key[0] > u32::MAX as u64)
    {
        return Err("Invalid asset cursor key".into());
    }
    let mut last = c.as_ref().map(|c| c.key[0] as u32);
    let primary = view::foreign::<_, tokens::tables::tables::BalanceTable>(tokens::SERVICE);
    let pending = view::foreign::<_, tokens::tables::tables::UserPendingTable>(tokens::SERVICE);
    let mut ids = vec![];
    for _ in 0..=limit {
        let low = last
            .map(|t| Excluded((owner, t)))
            .unwrap_or(Included((owner, 0)));
        let a = primary
            .get_index_pk()
            .range((low, Included((owner, u32::MAX))))
            .next()
            .map(|r| r.token_id);
        let low = last
            .map(|t| Excluded((owner, t, u64::MAX)))
            .unwrap_or(Included((owner, 0, 0)));
        let b = pending
            .get_index_pk()
            .range((low, Included((owner, u32::MAX, u64::MAX))))
            .next()
            .map(|r| r.token_id);
        let id = match (a, b) {
            (Some(a), Some(b)) => a.min(b),
            (Some(a), None) => a,
            (None, Some(b)) => b,
            (None, None) => break,
        };
        ids.push(id);
        last = Some(id);
    }
    let more = ids.len() > limit;
    ids.truncate(limit);
    let after = more.then(|| {
        next(
            Some(owner),
            "assets",
            None,
            &[],
            vec![*ids.last().unwrap() as u64],
        )
    });
    let mut balances = vec![];
    let mut tokens = vec![];
    for id in ids {
        let (b, t) = balance(owner, id)?;
        balances.push(b);
        tokens.push(t);
    }
    Ok(json!({"owner":owner,"balances":balances,"tokens":tokens,"next_after":after}))
}
/// Exact normalized owner receipts, scanned with a bounded continuation rather
/// than assuming an incomplete portfolio proves insufficient funds.
pub fn funding(
    owner: AccountNumber,
    tokens: &[u32],
    after: Option<&str>,
    limit: u32,
) -> Result<Value, String> {
    let limit = checked_limit(limit)?;
    if tokens.is_empty() || tokens.len() > 16 || tokens.windows(2).any(|w| w[0] >= w[1]) {
        return Err("Funding tokens must be sorted unique IDs (1 to 16)".into());
    }
    let c = cursor(after, Some(owner), "funding", None, tokens)?;
    let (mut phase, mut key) = if let Some(c) = c {
        if c.key.is_empty() || c.key[0] > 2 {
            return Err("Invalid funding cursor key".into());
        }
        (c.key[0] as usize, c.key[1..].to_vec())
    } else {
        (0, vec![])
    };
    let mut scanned = 0;
    let mut claims = vec![];
    let mut tids: BTreeSet<u32> = tokens.iter().copied().collect();
    let mut continuation = None;
    while phase < 3 && scanned < limit {
        let remaining = (limit - scanned) as u32;
        let (rows, ms, more, last_key) = if phase < 2 {
            let kind = if phase == 0 { "orders" } else { "loans" };
            let local = (!key.is_empty()).then(|| next(Some(owner), kind, None, &[], key.clone()));
            let p = positions(owner, kind, None, local.as_deref(), remaining, true)?;
            let rows = p["rows"].as_array().unwrap().clone();
            let ms = p["markets"]
                .as_array()
                .unwrap()
                .iter()
                .map(|m| (n(&m["id"]), m.clone()))
                .collect::<BTreeMap<_, _>>();
            let more = p["next_after"].as_str().is_some();
            let last = rows
                .last()
                .map(|r| {
                    vec![
                        n(&r["market"]),
                        u64::from(
                            r[if phase == 0 { "bid" } else { "long" }]
                                .as_bool()
                                .unwrap(),
                        ),
                        n(&r["price"]),
                    ]
                })
                .unwrap_or_default();
            (rows, ms, more, last)
        } else {
            if key.len() > 1 {
                return Err("Invalid funding stop cursor key".into());
            }
            let (rows, before) = view::stop_page(owner, key.first().copied(), remaining as usize);
            let (ids, _) = related(rows.iter().map(|r| n(&r["market"])), true)?;
            let ms = ids.into_iter().map(|m| (n(&m["id"]), m)).collect();
            let last = rows
                .last()
                .map(|r| vec![n(&r["generation"])])
                .unwrap_or_default();
            (rows, ms, before.is_some(), last)
        };
        scanned += rows.len();
        for row in rows {
            let m = &ms[&n(&row["market"])];
            if m["legacy_unsupported"] == true
                || m["escrow_base"]["funded"] != true
                || m["escrow_quote"]["funded"] != true
            {
                continue;
            }
            let base = n(&m["base"]) as u32;
            let quote = n(&m["quote"]) as u32;
            let mut payouts = BTreeMap::<u32, u64>::new();
            let action = match phase {
                0 => {
                    let bid = row["bid"].as_bool().unwrap();
                    let amount = n(&row["proceeds"]);
                    if amount > 0 {
                        payouts.insert(if bid { base } else { quote }, amount);
                    }
                    json!({"method":"settle","args":{"market":row["market"],"bid":bid,"price":row["price"]}})
                }
                1 => {
                    if row["active"] != false {
                        continue;
                    }
                    let long = row["long"].as_bool().unwrap();
                    let amount = n(&row["claimable_surplus"]);
                    if amount > 0 {
                        payouts.insert(if long { quote } else { base }, amount);
                    }
                    json!({"method":"claim","args":{"market":row["market"],"long":long,"price":row["price"]}})
                }
                _ => {
                    if !["filled", "partially_filled", "unfilled"]
                        .contains(&row["status"].as_str().unwrap_or(""))
                    {
                        continue;
                    }
                    let sell = row["sell_base"].as_bool().unwrap();
                    for (t, name) in [
                        (if sell { base } else { quote }, "claimable_input"),
                        (if sell { quote } else { base }, "claimable_output"),
                    ] {
                        let amount = n(&row[name]);
                        if amount > 0 {
                            payouts.insert(t, amount);
                        }
                    }
                    json!({"method":"claimstop","args":{"generation":row["generation"]}})
                }
            };
            if !payouts.keys().any(|t| tokens.contains(t)) {
                continue;
            }
            tids.extend([base, quote]);
            let payouts: serde_json::Map<_, _> = payouts
                .into_iter()
                .map(|(t, n)| (t.to_string(), json!(n.to_string())))
                .collect();
            claims.push(json!({"action":action,"payouts":payouts}));
        }
        if more {
            let mut k = vec![phase as u64];
            k.extend(last_key);
            continuation = Some(next(Some(owner), "funding", None, tokens, k));
            break;
        }
        phase += 1;
        key.clear();
        if phase < 3 && scanned == limit {
            continuation = Some(next(
                Some(owner),
                "funding",
                None,
                tokens,
                vec![phase as u64],
            ));
        }
    }
    let complete = phase >= 3;
    let mut balances = vec![];
    let mut metadata = vec![];
    for t in tids {
        let (b, m) = balance(owner, t)?;
        balances.push(b);
        metadata.push(m);
    }
    Ok(
        json!({"owner":owner,"balances":balances,"tokens":metadata,"claims":claims,"next_cursor":continuation,"scanned":scanned,"complete":complete}),
    )
}
/// A bounded first page for each independent collection, with exact selected
/// market/balance points. `continuations` and `coverage_complete` are explicit.
pub fn snapshot(
    owner: AccountNumber,
    selected: Option<u64>,
    native: bool,
) -> Result<Value, String> {
    let scoped = selected.is_some();
    let discovery = if scoped {
        json!({"markets":[],"next_after":null})
    } else {
        markets(0, MAX_PAGE, native)?
    };
    let discovery_ms = discovery["markets"].as_array().unwrap();
    let selected = selected.or_else(|| discovery_ms.first().map(|m| n(&m["id"])));
    if let Some(id) = selected {
        market(id)?;
    }
    let mut market_ids = BTreeSet::new();
    if scoped {
        market_ids.extend(selected);
    } else {
        market_ids.extend(discovery_ms.iter().map(|m| n(&m["id"])));
    }
    // Discovery is separate for explicit market scopes; compatibility queries
    // keep the first catalog page and global owner prefixes.
    let mut result = json!({"owner":owner,"selected_market":selected,"markets":[],"tokens":[],"levels":[],"positions":[],"loan_positions":[],"loans":[],"lenders":[],"relay_shares":[],"balances":[]});
    let mut continuations = json!({"markets":discovery["next_after"],"book_bid":null,"book_ask":null,"orders":null,"loans":null,"lenders":null,"liquidity":null,"assets":null,"stops":null});
    if let Some(id) = selected {
        for bid in [true, false] {
            let p = book(id, bid, None, MAX_PAGE)?;
            result["levels"]
                .as_array_mut()
                .unwrap()
                .extend(p["levels"].as_array().unwrap().iter().cloned());
            continuations[if bid { "book_bid" } else { "book_ask" }] = p["next_after"].clone();
        }
        result["levels_market"] = json!(id);
    }
    for kind in ["orders", "loans", "lenders", "liquidity"] {
        let p = positions(
            owner,
            kind,
            if scoped { selected } else { None },
            None,
            MAX_PAGE,
            native,
        )?;
        market_ids.extend(p["markets"].as_array().unwrap().iter().map(|m| n(&m["id"])));
        let field = match kind {
            "orders" => "positions",
            "loans" => "loan_positions",
            "lenders" => "lenders",
            _ => "relay_shares",
        };
        result[field] = p[field].clone();
        if kind == "loans" {
            result["loans"] = p["loans"].clone();
        }
        continuations[kind] = p["next_after"].clone();
    }
    let (stops, before) = view::stop_page(owner, None, MAX_PAGE as usize);
    market_ids.extend(stops.iter().map(|r| n(&r["market"])));
    result["stop_positions"] = json!(stops);
    result["stop_positions_next"] = json!(before.map(|v| v.to_string()));
    continuations["stops"] = result["stop_positions_next"].clone();
    let (ms, mut ts) = related(market_ids, native)?;
    result["markets"] = json!(ms);
    if native {
        let mut balances = BTreeMap::<u32, Value>::new();
        if !scoped {
            let p = assets(owner, None, MAX_PAGE)?;
            balances.extend(
                p["balances"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|r| (n(&r["token"]) as u32, r.clone())),
            );
            ts.extend(p["tokens"].as_array().unwrap().iter().cloned());
            continuations["assets"] = p["next_after"].clone();
        }
        if let Some(id) = selected {
            let m = market(id)?;
            for token in [m.base, m.quote] {
                let (b, t) = balance(owner, token)?;
                balances.insert(token, b);
                ts.push(t);
            }
        }
        result["balances"] = json!(balances.into_values().collect::<Vec<_>>());
    }
    let tokens: BTreeMap<u32, Value> = ts.into_iter().map(|t| (n(&t["id"]) as u32, t)).collect();
    result["tokens"] = json!(tokens.into_values().collect::<Vec<_>>());
    let complete = continuations
        .as_object()
        .unwrap()
        .values()
        .all(Value::is_null);
    result["continuations"] = continuations;
    result["coverage_complete"] = json!(complete);
    result["accrual_coverage"] =
        json!("bounded-position-pages; use funding for exact requested-token realization");
    result["stop_scope"] = json!("owner-global");
    result["asset_page_included"] = json!(native && !scoped);
    result["balance_scope"] = json!(if scoped {
        "selected-market-points"
    } else {
        "asset-page-plus-first-market-points"
    });
    result["coverage_scope"] = json!(if scoped {
        "selected-market-owner-prefixes-and-owner-global-stops"
    } else {
        "first-pages-of-global-owner-collections"
    });
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use psibase::account;
    #[test]
    fn cursor_scope_is_owner_kind_filter_and_requested_tokens() {
        let alice = account!("alice");
        let c = next(
            Some(alice),
            "funding",
            None,
            &[1, 7],
            vec![0, 52, 1, u64::MAX],
        );
        assert!(cursor(Some(&c), Some(alice), "funding", None, &[1, 7]).is_ok());
        assert!(cursor(Some(&c), Some(account!("bob")), "funding", None, &[1, 7]).is_err());
        assert!(cursor(Some(&c), Some(alice), "orders", None, &[1, 7]).is_err());
        assert!(cursor(Some(&c), Some(alice), "funding", Some(1), &[1, 7]).is_err());
        assert!(cursor(Some(&c), Some(alice), "funding", None, &[1, 8]).is_err());
        assert!(c
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'.'));
    }
    #[test]
    fn cursor_rejects_malformed_noncanonical_and_oversized_data() {
        let alice = account!("alice");
        for text in ["", "p1.", "p1.f", "p1.FF", "p1.ff", "p2.00"] {
            assert!(cursor(Some(text), Some(alice), "orders", None, &[]).is_err());
        }
        assert!(cursor(
            Some(&format!("p1.{}", "00".repeat(1025))),
            Some(alice),
            "orders",
            None,
            &[]
        )
        .is_err());
        let c = Cursor {
            v: 1,
            owner: alice.to_string(),
            kind: "orders".into(),
            filter: Some(3),
            tokens: vec![],
            key: vec![4, 0, 9],
        };
        assert!(key3(Some(&c), Some(3)).is_err());
        let c = Cursor {
            key: vec![3, 2, 9],
            ..c
        };
        assert!(key3(Some(&c), Some(3)).is_err());
    }
    #[test]
    fn page_limits_and_lossless_json_are_explicit() {
        assert!(checked_limit(0).is_err());
        assert!(checked_limit(201).is_err());
        assert_eq!(checked_limit(1).unwrap(), 1);
        assert_eq!(checked_limit(200).unwrap(), 200);
        let v: Value = serde_json::from_str(&text(json!({"id":u64::MAX,"small":3}))).unwrap();
        assert_eq!(v["id"], u64::MAX.to_string());
        assert_eq!(v["small"], 3);
    }
}
