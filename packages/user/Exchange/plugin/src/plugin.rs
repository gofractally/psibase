//! Native Psibase client plugin. The supervised call stack binds actions to
//! Exchange, account authentication signs the transaction, and all Tokens
//! operations cross Tokens' independent exact-transfer permission boundary.
#[allow(warnings)]
#[path = "bindings.rs"]
mod bindings;
use crate::plan::{self, Action, Amounts};
use bindings::exports::exchange::plugin::{queries::Guest as Queries, user::Guest as User};
use bindings::tokens::plugin::{helpers, transfer};
use bindings::{
    exports::transact_hook_pre_publish::Guest as PrePublishHook,
    transact::plugin::{hooks as TransactHooks, types::ActionScope},
};
use exchange::Wrapper as Exchange;
use psibase_plugin::{
    host::{
        server,
        store::{Bucket, Database, DbMode, StorageDuration},
    },
    trust::*,
    Error, Transact,
};
use serde_json::{json, Value};
struct ExchangePlugin;
impl TrustConfig for ExchangePlugin {
    fn capabilities() -> Capabilities {
        Capabilities {
            low: &[],
            medium: &[],
            high: &[
                "Read your Exchange balances and orders",
                "Place, cancel, and settle orders; manage liquidity and secured margin",
            ],
        }
    }
}
fn error(message: impl Into<String>) -> Error {
    Error {
        code: 1,
        producer: psibase_plugin::types::PluginId {
            service: "exchange".into(),
            plugin: "plugin".into(),
        },
        message: message.into(),
    }
}
fn decoded(body: String) -> Result<Value, Error> {
    let v: Value =
        serde_json::from_str(&body).map_err(|e| error(format!("Invalid native response: {e}")))?;
    if let Some(e) = v.get("error") {
        return Err(error(e.as_str().unwrap_or("Native query rejected")));
    }
    Ok(v)
}
fn private_query(endpoint: &str) -> Result<Value, Error> {
    let owner = bindings::host::accounts::api::get_current_user()
        .filter(|owner| !owner.is_empty())
        .ok_or_else(|| error("Connect an account first"))?;
    let value = decoded(server::get_json(endpoint)?)?;
    check_snapshot_owner(&value, &owner)?;
    check_expected(&owner)?;
    Ok(value)
}
fn snapshot() -> Result<Value, Error> {
    private_query("/snapshot")
}
fn cursor_query(endpoint: &mut String, after: Option<&str>) -> Result<(), Error> {
    plan::page_cursor(after).map_err(error)?;
    if let Some(after) = after {
        *endpoint += &format!("&after={}", plan::query_escape(after));
    }
    Ok(())
}
fn limit_check(limit: u32) -> Result<(), Error> {
    if !(1..=plan::PAGE_LIMIT as u32).contains(&limit) {
        return Err(error("Page limit must be 1 to 200"));
    }
    Ok(())
}
fn exact_market(id: u64) -> Result<Value, Error> {
    let value = decoded(server::get_json(&format!("/market?market={id}"))?)?;
    if plan::number(&value["market"]["id"]).map_err(error)? != id {
        return Err(error("Native market identity mismatch"));
    }
    Ok(value["market"].clone())
}
/// A funded operation needs at most one exact market and two exact assets.
/// Public catalog or portfolio pagination never determines spendability.
fn action_state(action: Option<&Action>, owner: &str) -> Result<Value, Error> {
    let mut markets = vec![];
    if let Some(action) = action {
        if action.args.get("market").is_some() {
            markets.push(exact_market(action.number("market"))?);
        }
    }
    check_expected(owner)?;
    Ok(json!({"owner":owner,"markets":markets,"balances":[]}))
}
fn funding_state(
    mut state: Value,
    needed: &Amounts,
    owner: &str,
    after: Option<&str>,
) -> Result<Value, Error> {
    plan::page_cursor(after).map_err(error)?;
    let mut balances = vec![];
    for &token in needed.keys() {
        let value = private_query(&format!("/asset?token={token}"))?;
        check_snapshot_owner(&value, owner)?;
        let row = plan::balance(&value, token)
            .ok_or_else(|| error("Native asset balance unavailable"))?;
        plan::number(&row["incoming"]).map_err(error)?;
        plan::number(&row["outgoing"]).map_err(error)?;
        if row["auto_debit"].as_bool().is_none() {
            return Err(error("Native asset settings unavailable"));
        }
        balances.push(row.clone());
    }
    state["balances"] = json!(balances);
    state["complete"] = json!(true);
    state["scanned"] = json!(0);
    state["claims"] = json!([]);
    if !plan::funds_ready(&state, needed) {
        let tokens = needed
            .keys()
            .map(u32::to_string)
            .collect::<Vec<_>>()
            .join(",");
        let mut endpoint = format!("/funding?tokens={tokens}&limit={}", plan::PAGE_LIMIT);
        cursor_query(&mut endpoint, after)?;
        let page = private_query(&endpoint)?;
        check_snapshot_owner(&page, owner)?;
        // The funding query takes a fresh atomic read of required balances and
        // receipt settings. Do not merge it with an older asset query.
        for &token in needed.keys() {
            let row = plan::balance(&page, token)
                .ok_or_else(|| error("Native funding balance unavailable"))?;
            plan::number(&row["incoming"]).map_err(error)?;
            plan::number(&row["outgoing"]).map_err(error)?;
            if row["auto_debit"].as_bool().is_none() {
                return Err(error("Native funding settings unavailable"));
            }
        }
        return Ok(page);
    }
    check_expected(owner)?;
    Ok(state)
}
fn check_expected(expected: &str) -> Result<(), Error> {
    let current = bindings::host::accounts::api::get_current_user();
    plan::expected_owner(expected, current.as_deref()).map_err(error)
}
fn check_snapshot_owner(state: &Value, expected: &str) -> Result<(), Error> {
    plan::expected_owner(expected, state["owner"].as_str()).map_err(error)
}
fn parse_uint(s: &str) -> Result<u64, Error> {
    plan::number(&json!(s)).map_err(error)
}
fn schedule(a: &Action) {
    let n = |key| a.number(key);
    let b = |key| a.flag(key);
    match a.method.as_str() {
        "create" => Exchange::add_to_tx().create(
            n("base") as u32,
            n("quote") as u32,
            n("base_amount"),
            n("quote_amount"),
            n("base_lot"),
            n("quote_tick"),
        ),
        "trade" => Exchange::add_to_tx().trade(
            n("market"),
            b("sell_base"),
            n("amount"),
            n("min_output"),
            n("max_events") as u32,
        ),
        "limit" => Exchange::add_to_tx().limit(n("market"), b("bid"), n("price"), n("amount")),
        "cancel" => Exchange::add_to_tx().cancel(n("market"), b("bid"), n("price")),
        "settle" => Exchange::add_to_tx().settle(n("market"), b("bid"), n("price")),
        "stop" => {
            Exchange::add_to_tx().stop(n("market"), b("sell_base"), n("trigger"), n("amount"))
        }
        "cancelstop" => Exchange::add_to_tx().cancelstop(n("generation")),
        "claimstop" => Exchange::add_to_tx().claimstop(n("generation")),
        "lend" => Exchange::add_to_tx().lend(n("market"), b("base"), n("amount")),
        "unlend" => Exchange::add_to_tx().unlend(n("market"), b("base"), n("shares")),
        "borrow" => Exchange::add_to_tx().borrow(n("market"), b("long"), n("price"), n("units")),
        "repay" => Exchange::add_to_tx().repay(n("market"), b("long"), n("price"), n("units")),
        "claim" => Exchange::add_to_tx().claim(n("market"), b("long"), n("price")),
        "liquidate" => Exchange::add_to_tx().liquidate(n("market"), n("max_events") as u32),
        "addliq" => Exchange::add_to_tx().addliq(n("market"), n("shares")),
        "remliq" => Exchange::add_to_tx().remliq(n("market"), n("shares")),
        "renew" => Exchange::add_to_tx().renew(n("market")),
        "process" => Exchange::add_to_tx().process(n("market")),
        _ => unreachable!("validated native action"),
    }
}
fn recredit(state: &Value, accrued: &Amounts, expected_owner: &str) -> Result<(), Error> {
    for (&token, &amount) in accrued {
        if amount > 0 && plan::auto_debit(state, token) {
            let decimal = helpers::u64_to_decimal(token, amount)?;
            transfer::credit(
                token,
                "exchange",
                &decimal,
                "Exchange proceeds",
                expected_owner,
            )?;
        }
    }
    Ok(())
}
/// Pin the exact client plan while a Tokens confirmation is open. This is not
/// an authorization: all native actions and every Tokens transfer still pass
/// their own checks. Live maker accrual must not silently alter an amount which
/// the user just reviewed. Native failure rolls back the consumed marker.
#[derive(serde::Serialize, serde::Deserialize)]
struct PendingPlan {
    owner: String,
    app: String,
    sealed: bool,
    nonce: u64,
    created: u64,
    request: String,
    #[serde(default)]
    funding_after: Option<String>,
    #[serde(default)]
    scanned: u64,
    #[serde(default)]
    funding_complete: bool,
    state: Value,
    preparation: plan::Preparation,
    recredits: Amounts,
}
fn plan_bucket(mode: DbMode) -> Bucket {
    Bucket::new(
        Database {
            mode,
            duration: StorageDuration::Session,
        },
        "exchange-wallet-plan-v2",
    )
}
enum Prepared {
    Transaction(PendingPlan),
    Scan { cursor: String, scanned: u64 },
}
fn prepared(
    state: &Value,
    needed: &Amounts,
    request: &str,
    funding_after: Option<&str>,
) -> Result<Prepared, Error> {
    let owner = state["owner"]
        .as_str()
        .ok_or_else(|| error("Connect an account first"))?;
    let app = psibase_plugin::host::client::get_active_app();
    let scope = format!("{owner}:{app}");
    let pending = plan_bucket(DbMode::NonTransactional);
    let committed = plan_bucket(DbMode::Transactional);
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| error("Invalid device clock"))?
        .as_secs();
    let consumed = committed
        .get(&scope)
        .and_then(|bytes| serde_json::from_slice::<u64>(&bytes).ok())
        .unwrap_or(0);
    let previous = pending
        .get(&scope)
        .and_then(|bytes| serde_json::from_slice::<PendingPlan>(&bytes).ok());
    let next_nonce = previous
        .as_ref()
        .map(|p| p.nonce)
        .unwrap_or(0)
        .max(consumed)
        .checked_add(1)
        .ok_or_else(|| error("Client plan nonce exhausted"))?;
    let pinned = previous.filter(|p| {
        p.funding_after.as_deref() == funding_after
            && plan::reusable_plan(
                p.sealed, p.nonce, consumed, p.created, now, &p.request, request,
            )
    });
    let pinned = if let Some(plan) = pinned {
        plan
    } else {
        let (preparation, scanned, complete) =
            match plan::funding_step(state, needed, funding_after).map_err(error)? {
                plan::FundingStep::Scan { cursor, scanned } => {
                    return Ok(Prepared::Scan { cursor, scanned })
                }
                plan::FundingStep::Transaction {
                    preparation,
                    scanned,
                    complete,
                } => (preparation, scanned, complete),
            };
        // Keep only selected balances/settings, not a portfolio history.
        let assets: std::collections::BTreeSet<_> = needed
            .keys()
            .chain(preparation.accrued.keys())
            .copied()
            .collect();
        let balances: Vec<_> = assets
            .into_iter()
            .filter_map(|token| plan::balance(state, token).cloned())
            .collect();
        let plan = PendingPlan {
            owner: owner.into(),
            app: app.clone(),
            sealed: false,
            nonce: next_nonce,
            created: now,
            request: request.into(),
            funding_after: funding_after.map(str::to_owned),
            scanned,
            funding_complete: complete,
            state: json!({"balances":balances}),
            recredits: plan::recredits(state, needed, &preparation.accrued),
            preparation,
        };
        pending.set(
            &scope,
            &serde_json::to_vec(&plan).map_err(|_| error("Could not save client plan"))?,
        );
        plan
    };
    for claim in &pinned.preparation.claims {
        schedule(&claim.action);
    }
    plan::expected_owner(owner, Some(pinned.owner.as_str())).map_err(error)?;
    recredit(&pinned.state, &pinned.recredits, &pinned.owner)?;
    // Committed only after the whole supervised/native transaction succeeds.
    // A prompt leaves the exact plan reusable. The publication callback also
    // seals it nontransactionally before RPC, so unknown/rejected submissions
    // cannot restore this snapshot and its stale claim amounts.
    committed.set(&scope, &serde_json::to_vec(&pinned.nonce).unwrap());
    stage_plan(&scope, &pinned)?;
    Ok(Prepared::Transaction(pinned))
}

#[derive(serde::Serialize, serde::Deserialize)]
struct StagedPlan {
    scope: String,
    owner: String,
    app: String,
    nonce: u64,
    request: String,
}
fn staged_plans() -> Bucket {
    Bucket::new(
        Database {
            mode: DbMode::NonTransactional,
            duration: StorageDuration::Ephemeral,
        },
        "exchange-publication-plan",
    )
}
fn stage_plan(scope: &str, pending: &PendingPlan) -> Result<(), Error> {
    let table = staged_plans();
    if table.exists("pending") {
        return Err(error(
            "Compose at most one Exchange operation in a transaction",
        ));
    }
    let staged = StagedPlan {
        scope: scope.into(),
        owner: pending.owner.clone(),
        app: pending.app.clone(),
        nonce: pending.nonce,
        request: pending.request.clone(),
    };
    table.set("pending", &serde_json::to_vec(&staged).unwrap());
    TransactHooks::register_pre_publish_hook()?;
    Ok(())
}
impl PrePublishHook for ExchangePlugin {
    fn on_pre_publish(actions: Vec<ActionScope>) -> Result<(), Error> {
        // Check the authenticated caller before opening/modifying pending state.
        let publisher = psibase_plugin::host::client::get_sender();
        if publisher != "transact" {
            return Err(error("Only native Transact may seal an Exchange plan"));
        }
        let table = staged_plans();
        let staged: StagedPlan = table
            .get("pending")
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .ok_or_else(|| error("No staged Exchange plan"))?;
        let pending = plan_bucket(DbMode::NonTransactional);
        let mut plan: PendingPlan = pending
            .get(&staged.scope)
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .ok_or_else(|| error("Pending Exchange plan disappeared"))?;
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|_| error("Invalid device clock"))?
            .as_secs();
        if !plan::reusable_plan(
            plan.sealed,
            plan.nonce,
            0,
            plan.created,
            now,
            &plan.request,
            &staged.request,
        ) || plan.nonce != staged.nonce
            || plan.owner != staged.owner
            || plan.app != staged.app
            || plan.request != staged.request
            || plan.sealed
        {
            return Err(error(
                "Pending Exchange plan changed or was already published",
            ));
        }
        plan::publication_scope(
            &publisher,
            &staged.owner,
            bindings::host::accounts::api::get_current_user().as_deref(),
            &staged.app,
            &psibase_plugin::host::client::get_active_app(),
            &plan.request,
            plan.preparation.ready,
            actions
                .iter()
                .map(|a| (a.sender.as_str(), a.service.as_str())),
        )
        .map_err(error)?;
        // This immediate seal survives rejection, timeout, response loss and
        // client exit. None of these may resurrect stale receipt plans. Signing
        // and transfer prompts occur before this hook and keep the plan intact.
        plan.sealed = true;
        pending.set(&staged.scope, &serde_json::to_vec(&plan).unwrap());
        table.delete("pending");
        Ok(())
    }
}

fn result(p: &PendingPlan) -> String {
    json!({"status":if p.preparation.ready {"executed"} else {"prepared"},
        "executed":p.preparation.ready,"prepared":p.preparation.claims.len(),
        "funding_cursor":if p.preparation.ready {None} else {p.funding_after.as_deref()},
        "scanned":p.scanned,"funding_complete":p.funding_complete})
    .to_string()
}
fn scan_result(cursor: &str, scanned: u64) -> String {
    json!({"status":"scan_progress","executed":false,"prepared":0,
        "funding_cursor":cursor,"scanned":scanned,"funding_complete":false})
    .to_string()
}
impl Queries for ExchangePlugin {
    #[psibase_plugin::authorized(High)]
    fn snapshot() -> Result<String, Error> {
        Ok(snapshot()?.to_string())
    }
    #[psibase_plugin::authorized(High)]
    fn market(market: String) -> Result<String, Error> {
        let id = parse_uint(&market)?;
        let value = decoded(server::get_json(&format!("/market?market={id}"))?)?;
        if plan::number(&value["market"]["id"]).map_err(error)? != id {
            return Err(error("Native market identity mismatch"));
        }
        Ok(value.to_string())
    }
    #[psibase_plugin::authorized(High)]
    fn scoped_snapshot(market: Option<String>) -> Result<String, Error> {
        let endpoint = match market {
            Some(id) => format!("/snapshot?market={}", parse_uint(&id)?),
            None => "/snapshot".into(),
        };
        Ok(private_query(&endpoint)?.to_string())
    }
    #[psibase_plugin::authorized(High)]
    fn positions(
        kind: String,
        market: Option<String>,
        after: Option<String>,
        limit: u32,
    ) -> Result<String, Error> {
        limit_check(limit)?;
        if !["orders", "loans", "lenders", "liquidity"].contains(&kind.as_str()) {
            return Err(error("Unsupported position kind"));
        }
        let mut endpoint = format!("/positions?kind={kind}&limit={limit}");
        if let Some(market) = market {
            endpoint += &format!("&market={}", parse_uint(&market)?);
        }
        cursor_query(&mut endpoint, after.as_deref())?;
        Ok(private_query(&endpoint)?.to_string())
    }
    #[psibase_plugin::authorized(High)]
    fn position(
        kind: String,
        market: String,
        side: Option<bool>,
        price: Option<String>,
    ) -> Result<String, Error> {
        let endpoint = plan::position_key(&kind, &market, side, price.as_deref()).map_err(error)?;
        Ok(private_query(&endpoint)?.to_string())
    }
    #[psibase_plugin::authorized(High)]
    fn assets(after: Option<String>, limit: u32) -> Result<String, Error> {
        limit_check(limit)?;
        let mut endpoint = format!("/assets?limit={limit}");
        cursor_query(&mut endpoint, after.as_deref())?;
        Ok(private_query(&endpoint)?.to_string())
    }
    #[psibase_plugin::authorized(High)]
    fn asset(token: u32) -> Result<String, Error> {
        Ok(private_query(&format!("/asset?token={token}"))?.to_string())
    }
    #[psibase_plugin::authorized(High)]
    fn stops(before: Option<String>, limit: u32) -> Result<String, Error> {
        if !(1..=200).contains(&limit) {
            return Err(error("Stop page limit must be 1 to 200"));
        }
        let mut endpoint = format!("/stops?limit={limit}");
        if let Some(before) = before {
            endpoint += &format!("&before={}", parse_uint(&before)?);
        }
        Ok(private_query(&endpoint)?.to_string())
    }
    #[psibase_plugin::authorized(High)]
    fn stop(generation: String) -> Result<String, Error> {
        Ok(private_query(&format!("/stop?generation={}", parse_uint(&generation)?))?.to_string())
    }
    #[psibase_plugin::authorized(High)]
    fn history(token_id: u32, before: Option<String>, limit: u32) -> Result<String, Error> {
        transfer::history(token_id, before.as_deref(), limit)
    }
}
impl User for ExchangePlugin {
    #[psibase_plugin::authorized(High)]
    fn execute(
        method: String,
        args_json: String,
        expected_owner: String,
        funding_after: Option<String>,
    ) -> Result<String, Error> {
        check_expected(&expected_owner)?;
        if args_json.len() > 8192 {
            return Err(error("Action arguments too large"));
        }
        let args = serde_json::from_str(&args_json).map_err(|_| error("Invalid action JSON"))?;
        let action = Action::new(&method, args).map_err(error)?;
        let state = action_state(Some(&action), &expected_owner)?;
        let needed = plan::required(&state, &action).map_err(error)?;
        let state = funding_state(state, &needed, &expected_owner, funding_after.as_deref())?;
        let pending = match prepared(
            &state,
            &needed,
            &format!("execute:{method}:{}", action.args),
            funding_after.as_deref(),
        )? {
            Prepared::Scan { cursor, scanned } => return Ok(scan_result(&cursor, scanned)),
            Prepared::Transaction(pending) => pending,
        };
        check_expected(&expected_owner)?;
        let p = &pending.preparation;
        if p.ready {
            schedule(&action);
        }
        Ok(result(&pending))
    }
    #[psibase_plugin::authorized(High)]
    fn withdraw(
        token_id: u32,
        amount: String,
        expected_owner: String,
        funding_after: Option<String>,
    ) -> Result<String, Error> {
        check_expected(&expected_owner)?;
        let amount = parse_uint(&amount)?;
        if amount == 0 {
            return Err(error("Enter a positive withdrawal amount"));
        }
        let needed = Amounts::from([(token_id, amount)]);
        let state = funding_state(
            action_state(None, &expected_owner)?,
            &needed,
            &expected_owner,
            funding_after.as_deref(),
        )?;
        let pending = match prepared(
            &state,
            &needed,
            &format!("withdraw:{token_id}:{amount}"),
            funding_after.as_deref(),
        )? {
            Prepared::Scan { cursor, scanned } => return Ok(scan_result(&cursor, scanned)),
            Prepared::Transaction(pending) => pending,
        };
        check_expected(&expected_owner)?;
        let p = &pending.preparation;
        let state = &pending.state;
        if p.ready {
            let incoming = plan::balance(&state, token_id)
                .map(|b| plan::number(&b["incoming"]).unwrap_or(0))
                .unwrap_or(0);
            // Claims with AUTO_DEBIT off add incoming; AUTO_DEBIT on are credited
            // back above and therefore add outgoing. Both paths remain native.
            let incoming = incoming
                .checked_add(if plan::auto_debit(&state, token_id) {
                    0
                } else {
                    p.accrued.get(&token_id).copied().unwrap_or(0)
                })
                .ok_or_else(|| error("Withdrawal amount overflow"))?;
            let accept = incoming.min(amount);
            if accept > 0 {
                transfer::debit(
                    token_id,
                    "exchange",
                    &helpers::u64_to_decimal(token_id, accept)?,
                    "Exchange withdrawal",
                    &pending.owner,
                )?;
            }
            if amount > accept {
                transfer::uncredit(
                    token_id,
                    "exchange",
                    &helpers::u64_to_decimal(token_id, amount - accept)?,
                    "Exchange withdrawal",
                    &pending.owner,
                )?;
            }
        }
        Ok(result(&pending))
    }
    #[psibase_plugin::authorized(High)]
    fn release_position(
        kind: String,
        market: String,
        side: Option<bool>,
        price: Option<String>,
        expected_owner: String,
    ) -> Result<(), Error> {
        check_expected(&expected_owner)?;
        if !["orders", "loans"].contains(&kind.as_str()) {
            return Err(error(
                "Only order proceeds and closed loan receipts can be released",
            ));
        }
        let endpoint = plan::position_key(&kind, &market, side, price.as_deref()).map_err(error)?;
        let mut response = private_query(&endpoint)?;
        check_snapshot_owner(&response, &expected_owner)?;
        let entries = plan::claims(&response);
        if entries.len() != 1 {
            return Err(error("This position has no available receipt"));
        }
        let claim = &entries[0];
        let expected_method = if kind == "orders" { "settle" } else { "claim" };
        let flag = if kind == "orders" { "bid" } else { "long" };
        if claim.action.method != expected_method
            || claim.action.number("market") != parse_uint(&market)?
            || claim.action.flag(flag) != side.unwrap()
            || claim.action.number("price") != parse_uint(price.as_deref().unwrap())?
        {
            return Err(error("Native position identity mismatch"));
        }
        let mut balances = vec![];
        for &token in claim.payouts.keys() {
            let asset = private_query(&format!("/asset?token={token}"))?;
            check_snapshot_owner(&asset, &expected_owner)?;
            let row = plan::balance(&asset, token)
                .ok_or_else(|| error("Native receipt settings unavailable"))?;
            if row["auto_debit"].as_bool().is_none() {
                return Err(error("Native receipt settings unavailable"));
            }
            balances.push(row.clone());
        }
        response["balances"] = json!(balances);
        check_expected(&expected_owner)?;
        schedule(&claim.action);
        recredit(&response, &claim.payouts, &expected_owner)
    }
    #[psibase_plugin::authorized(High)]
    fn release_stop(generation: String, expected_owner: String) -> Result<(), Error> {
        check_expected(&expected_owner)?;
        let id = parse_uint(&generation)?;
        let response = private_query(&format!("/stop?generation={id}"))?;
        check_snapshot_owner(&response, &expected_owner)?;
        let p = &response["stop_position"];
        if p.is_null() {
            return Err(error("This stop order is no longer available"));
        }
        if !["filled", "partially_filled", "unfilled"].contains(&p["status"].as_str().unwrap_or(""))
        {
            return Err(error("This stop order is still waiting for its trigger"));
        }
        let mut accrued = Amounts::new();
        let mut flags = vec![];
        for side in ["input", "output"] {
            let token = plan::number(&p[format!("{side}_token")]).map_err(error)?;
            if token > u32::MAX as u64 {
                return Err(error("Invalid receipt token"));
            }
            let amount = plan::number(&p[format!("claimable_{side}")]).map_err(error)?;
            let auto = p[format!("{side}_auto_debit")]
                .as_bool()
                .ok_or_else(|| error("Native receipt settings unavailable"))?;
            if amount > 0 {
                accrued.insert(token as u32, amount);
            }
            flags.push(json!({"token":token,"auto_debit":auto}));
        }
        if flags[0]["token"] == flags[1]["token"] {
            return Err(error("Invalid native receipt assets"));
        }
        schedule(&Action::new("claimstop", json!({"generation":id})).map_err(error)?);
        recredit(&json!({"balances":flags}), &accrued, &expected_owner)
    }
}
bindings::export!(ExchangePlugin with_types_in bindings);
