//! Tokens-owned, exact transfer review and narrowly scoped client-side trust.
//! Pending approvals survive a redirect. Composition stages consumption in
//! Host's transactional/ephemeral stores, so later prompts do not consume it.
//! The trusted native publisher permanently seals exact approvals immediately
//! before broadcast: a rejected/lost response never revives them. No private
//! keys or on-chain allowances are introduced.
use crate::{bindings, errors::ErrorType, query, transfer_policy::*, TokensPlugin};
use bindings::{
    exports::tokens::plugin::{
        transfer::Guest as Transfer, transfer_admin::Guest as TransferAdmin,
    },
    exports::transact_hook_pre_publish::Guest as PrePublishHook,
    host::accounts::api as Accounts,
    transact::plugin::{hooks as TransactHooks, types::ActionScope},
};
use psibase::{
    services::tokens::{Decimal, Quantity},
    AccountNumber,
};
use psibase_plugin::{
    host::{
        client, prompt,
        store::{Bucket, Database, DbMode, StorageDuration},
    },
    Error, Transact,
};
use tokens::Wrapper as Tokens;

fn error(message: &str) -> Error {
    ErrorType::TransferPermission(message.into()).into()
}
fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("system clock predates epoch")
        .as_secs()
}
fn bucket(name: &str, mode: DbMode, duration: StorageDuration) -> Bucket {
    Bucket::new(Database { mode, duration }, name)
}
fn session() -> Bucket {
    bucket(
        "exact-transfer-review-v3",
        DbMode::NonTransactional,
        StorageDuration::Session,
    )
}
fn consumed() -> Bucket {
    bucket(
        "exact-transfer-consumed",
        DbMode::Transactional,
        StorageDuration::Session,
    )
}
fn global_approvals() -> Bucket {
    bucket(
        "exact-transfer-global-v1",
        DbMode::NonTransactional,
        StorageDuration::Persistent,
    )
}
fn staged() -> Bucket {
    bucket(
        "exact-transfer-staged",
        DbMode::NonTransactional,
        StorageDuration::Ephemeral,
    )
}
fn trusts() -> Bucket {
    bucket(
        "app-transfer-trust",
        DbMode::NonTransactional,
        StorageDuration::Persistent,
    )
}
fn scope() -> Result<(String, String, String), Error> {
    let caller = client::get_sender();
    let user = Accounts::get_current_user().ok_or_else(|| error("connect an account first"))?;
    if !valid_scope(&client::get_active_app(), &user, &caller, &caller) {
        return Err(error(
            "only the active app may request its own wallet transfers",
        ));
    }
    Ok((format!("{user}:{caller}"), user, caller))
}
fn requests(key: &str) -> Vec<Request> {
    session()
        .get(key)
        .map(|b| psio::from_pssz::<Vec<Request>>(&b).expect("invalid transfer review store"))
        .unwrap_or_default()
}
fn save(key: &str, requests: &[Request]) {
    session().set(key, &psio::to_pssz(&requests.to_vec()));
}
fn consumed_key(key: &str, id: u64) -> String {
    format!("{key}:{id}")
}
fn was_consumed(key: &str, id: u64) -> bool {
    let global = global_approvals();
    let revoked_through = global
        .get(&format!("{key}:revoked-through"))
        .map(|b| psio::from_pssz::<u64>(&b).unwrap())
        .unwrap_or(0);
    consumed().exists(&consumed_key(key, id))
        || !grant_available(
            id,
            global.exists(&format!("{key}:spent:{id}")),
            revoked_through,
        )
}

#[derive(Clone, psio::PsszPack, psio::PsszUnpack, psio::ToPsszSchema, psio::JsonText)]
struct PromptRef {
    key: String,
    id: u64,
}

#[derive(psio::PsszPack, psio::PsszUnpack, psio::ToPsszSchema, psio::JsonText)]
struct TransferScope {
    user: String,
    caller: String,
}

#[derive(psio::PsszPack, psio::PsszUnpack, psio::ToPsszSchema, psio::JsonText)]
struct SpentApproval {
    id: u64,
    expires: u64,
}

fn seal_global_approvals(
    key: &str,
    requests: &[Request],
    indices: &std::collections::BTreeSet<usize>,
    time: u64,
) -> Result<(), Error> {
    let table = global_approvals();
    let index_key = format!("{key}:spent-index");
    let mut spent = table
        .get(&index_key)
        .map(|bytes| psio::from_pssz::<Vec<SpentApproval>>(&bytes).unwrap())
        .unwrap_or_default();
    let floor_key = format!("{key}:revoked-through");
    let previous_floor = table
        .get(&floor_key)
        .map(|bytes| psio::from_pssz::<u64>(&bytes).unwrap())
        .unwrap_or(0);
    let floor = advance_revocation_floor(
        previous_floor,
        spent
            .iter()
            .filter(|record| record.expires <= time)
            .map(|record| record.id),
    );
    // A deleted spent flag must never resurrect a copied grant if the device
    // clock subsequently rolls back. Persist the floor BEFORE deleting flags.
    if floor != previous_floor {
        table.set(&floor_key, &psio::to_pssz(&floor));
    }
    spent.retain(|record| {
        if record.expires > time {
            true
        } else {
            table.delete(&format!("{key}:spent:{}", record.id));
            false
        }
    });
    if spent.len() + indices.len() > MAX_PENDING {
        return Err(error(
            "too many recent one-time wallet transfers; wait five minutes before trying again",
        ));
    }
    for index in indices {
        let request = &requests[*index];
        if !grant_available(
            request.id,
            table.exists(&format!("{key}:spent:{}", request.id)),
            floor,
        ) {
            return Err(error("transfer approval already spent in another window"));
        }
        spent.push(SpentApproval {
            id: request.id,
            expires: request
                .created
                .checked_add(APPROVAL_TTL_SECONDS)
                .ok_or_else(|| error("approval expiry overflow"))?,
        });
    }
    // Persist the bounded GC index before individual flags. If interrupted here
    // no RPC has started. Once every flag is saved, even copied session storage
    // in another tab cannot revive this consent after an unknown RPC outcome.
    table.set(&index_key, &psio::to_pssz(&spent));
    for index in indices {
        table.set(&format!("{key}:spent:{}", requests[*index].id), &[1]);
    }
    Ok(())
}

fn guard_submission(user: &str, caller: &str) -> Result<(), Error> {
    let table = staged();
    if let Some(bytes) = table.get("scope") {
        let previous = psio::from_pssz::<TransferScope>(&bytes).unwrap();
        if previous.user != user || previous.caller != caller {
            return Err(error(
                "wallet account or requesting app changed during composition",
            ));
        }
    } else {
        table.set(
            "scope",
            &psio::to_pssz(&TransferScope {
                user: user.into(),
                caller: caller.into(),
            }),
        );
    }
    // No peer identity is accepted by this API; Transact records Tokens from
    // Host's authenticated call stack. Duplicate registration is harmless.
    TransactHooks::register_pre_publish_hook()?;
    Ok(())
}

fn stage(reference: PromptRef) -> Result<(), Error> {
    let table = staged();
    let mut references = table
        .get("pending")
        .map(|b| psio::from_pssz::<Vec<PromptRef>>(&b).unwrap())
        .unwrap_or_default();
    if references.len() >= MAX_PENDING {
        return Err(error("too many exact transfers in one transaction"));
    }
    if references
        .iter()
        .any(|r| r.key == reference.key && r.id == reference.id)
    {
        return Err(error("an exact transfer approval may only be staged once"));
    }
    references.push(reference);
    table.set("pending", &psio::to_pssz(&references));
    Ok(())
}

fn authorize(intent: Intent) -> Result<(), Error> {
    let (key, user, caller) = scope()?;
    if !valid_expected_user(&user, &intent.user) {
        return Err(error("selected account changed; review the transfer again"));
    }
    if !valid_scope(
        &client::get_active_app(),
        &user,
        &caller,
        &intent.counterparty,
    ) {
        return Err(error(
            "the transfer counterparty must equal the requesting app",
        ));
    }
    let time = now();
    let mut pending = requests(&key);
    if let Some(request) = pending
        .iter()
        .find(|r| r.can_consume(&intent, time, was_consumed(&key, r.id)))
    {
        // Later prompts/signing failures roll this staging back. The trusted
        // publisher seals it nontransactionally before the RPC is attempted.
        stage(PromptRef {
            key: key.clone(),
            id: request.id,
        })?;
        consumed().set(&consumed_key(&key, request.id), &[1]);
        return Ok(());
    }
    if trusts().exists(&key) {
        return Ok(());
    }
    pending.retain(|r| {
        let keep = r.unexpired(time) && !r.denied && !r.sealed && !was_consumed(&key, r.id);
        // Dropped requests can never be resurrected, so their tombstones need
        // not accumulate in session storage. Deletion itself is transactional.
        if !keep {
            consumed().delete(&consumed_key(&key, r.id));
        }
        keep
    });
    let id = if let Some(request) = pending.iter().find(|r| r.intent == intent && !r.approved) {
        request.id
    } else {
        if pending.len() >= MAX_PENDING {
            return Err(error(
                "too many unfinished transfer reviews; wait five minutes",
            ));
        }
        let nonce_key = format!("{key}:nonce");
        // The Supervisor's origin-wide native transaction lock protects this
        // persistent counter and the later shared check-and-spend boundary.
        // A new tab gets a new ID; a copied pending grant keeps the same ID.
        let global = global_approvals();
        let id = global
            .get(&nonce_key)
            .map(|v| psio::from_pssz::<u64>(&v).unwrap())
            .unwrap_or(0)
            .checked_add(1)
            .ok_or_else(|| error("transfer review nonce exhausted"))?;
        global.set(&nonce_key, &psio::to_pssz(&id));
        pending.push(Request {
            id,
            intent,
            created: time,
            approved: false,
            denied: false,
            sealed: false,
        });
        id
    };
    save(&key, &pending);
    prompt::prompt("transfer", Some(&PromptRef { key, id }));
    // A prompt aborts this execution before any native transaction is published.
    Err(error("transfer review was not approved"))
}

fn add_transfer(
    operation: u8,
    token_id: u32,
    counterparty: String,
    amount: String,
    memo: String,
    expected_user: String,
) -> Result<(), Error> {
    let (_, user, caller) = scope()?;
    // This is a precondition, never a request to select or impersonate a user.
    // Check before looking up the token, remembering trust, or adding actions.
    if !valid_expected_user(&user, &expected_user) {
        return Err(error("selected account changed; review the transfer again"));
    }
    let account: AccountNumber = counterparty
        .parse()
        .map_err(|_| error("invalid counterparty account"))?;
    if account.to_string() != counterparty {
        return Err(error("counterparty must be canonical"));
    }
    let quantity = TokensPlugin::non_zero(token_id, amount)?;
    // Validate memo before obtaining approval, preserving its exact bytes.
    let native_memo = memo
        .clone()
        .try_into()
        .map_err(|_| error("invalid transfer memo"))?;
    authorize(Intent {
        user: user.clone(),
        caller: caller.clone(),
        operation,
        token_id,
        counterparty,
        amount: quantity.value,
        memo,
    })?;
    // Remembered and exact consent both bind the final signed Tokens senders.
    guard_submission(&user, &caller)?;
    match operation {
        0 => {
            Tokens::add_to_tx().credit(token_id, account, quantity, native_memo);
        }
        1 => {
            Tokens::add_to_tx().uncredit(token_id, account, quantity, native_memo);
        }
        2 => {
            Tokens::add_to_tx().debit(token_id, account, quantity, native_memo);
        }
        _ => unreachable!("private operation enum"),
    }
    Ok(())
}

impl Transfer for TokensPlugin {
    fn credit(
        token_id: u32,
        debitor: String,
        amount: String,
        memo: String,
        expected_user: String,
    ) -> Result<(), Error> {
        add_transfer(0, token_id, debitor, amount, memo, expected_user)
    }
    fn uncredit(
        token_id: u32,
        debitor: String,
        amount: String,
        memo: String,
        expected_user: String,
    ) -> Result<(), Error> {
        add_transfer(1, token_id, debitor, amount, memo, expected_user)
    }
    fn debit(
        token_id: u32,
        creditor: String,
        amount: String,
        memo: String,
        expected_user: String,
    ) -> Result<(), Error> {
        add_transfer(2, token_id, creditor, amount, memo, expected_user)
    }
    fn trust_status() -> bool {
        scope()
            .map(|(key, _, _)| trusts().exists(&key))
            .unwrap_or(false)
    }
    fn revoke_trust() -> Result<(), Error> {
        let (key, _, _) = scope()?;
        trusts().delete(&key);
        // Invalidate unfinished approvals in copied/other session-storage tabs
        // as well. IDs issued after this explicit revocation remain usable.
        let global = global_approvals();
        let nonce = global
            .get(&format!("{key}:nonce"))
            .map(|b| psio::from_pssz::<u64>(&b).unwrap())
            .unwrap_or(0);
        global.set(&format!("{key}:revoked-through"), &psio::to_pssz(&nonce));
        for request in requests(&key) {
            consumed().delete(&consumed_key(&key, request.id));
        }
        session().delete(&key);
        Ok(())
    }
    fn approval_status() -> String {
        let Ok((key, _, _)) = scope() else {
            return "none".into();
        };
        match requests(&key).last() {
            None => "none",
            Some(r) if r.sealed || was_consumed(&key, r.id) => "consumed",
            Some(r) if !r.unexpired(now()) => "expired",
            Some(r) if r.denied => "denied",
            Some(r) if r.approved => "approved",
            Some(_) => "pending",
        }
        .into()
    }
    fn history(token_id: u32, before: Option<String>, limit: u32) -> Result<String, Error> {
        let (_, user, caller) = scope()?;
        if !(1..=100).contains(&limit) {
            return Err(error("history limit must be 1 through 100"));
        }
        if before.as_ref().is_some_and(|s| s.len() > 256) {
            return Err(error("history cursor too long"));
        }
        let quoted_user = serde_json::to_string(&user).unwrap();
        let quoted_caller = serde_json::to_string(&caller).unwrap();
        let cursor = before
            .map(|s| format!(",before:{}", serde_json::to_string(&s).unwrap()))
            .unwrap_or_default();
        let query = format!("{{balChanges(tokenId:{token_id},account:{quoted_user},counterParties:[{quoted_caller}],last:{limit}{cursor}){{edges{{cursor node{{block{{blockNum blockTime}} tokenId account counterParty action amount memo}}}} pageInfo{{hasPreviousPage hasNextPage startCursor endCursor}}}}}}");
        let raw = psibase_plugin::host::server::post_graphql_get_json(&query)?;
        let mut result: serde_json::Value =
            serde_json::from_str(&raw).map_err(|_| error("invalid native history response"))?;
        let edges = result
            .pointer_mut("/data/balChanges/edges")
            .and_then(|e| e.as_array_mut())
            .ok_or_else(|| error("native history response has no edges"))?;
        // The native GraphQL counterParties search currently uses LIKE. Never
        // disclose substring matches from unrelated apps through this interface.
        edges.retain(|e| {
            e.pointer("/node/counterParty").and_then(|v| v.as_str()) == Some(caller.as_str())
                && e.pointer("/node/account").and_then(|v| v.as_str()) == Some(user.as_str())
        });
        Ok(result.to_string())
    }
}

fn prompt_request(expected_id: Option<&str>) -> Result<(String, Vec<Request>, usize), Error> {
    if client::get_sender() != client::get_receiver() {
        return Err(error(
            "only the Tokens confirmation UI may approve transfers",
        ));
    }
    let reference =
        prompt::get_context::<PromptRef>().ok_or_else(|| error("no active transfer review"))?;
    if expected_id.is_some_and(|id| id != reference.id.to_string()) {
        return Err(error("transfer review changed"));
    }
    let pending = requests(&reference.key);
    let index = pending
        .iter()
        .position(|r| r.id == reference.id)
        .ok_or_else(|| error("transfer review no longer exists"))?;
    let request = &pending[index];
    if Accounts::get_current_user().as_deref() != Some(request.intent.user.as_str())
        || !valid_scope(
            &client::get_active_app(),
            &request.intent.user,
            &request.intent.caller,
            &request.intent.counterparty,
        )
        || !request.unexpired(now())
        || was_consumed(&reference.key, request.id)
        || request.sealed
        || request.denied
    {
        return Err(error(
            "transfer review expired, changed account, or was already used",
        ));
    }
    Ok((reference.key, pending, index))
}

impl PrePublishHook for TokensPlugin {
    fn on_pre_publish(actions: Vec<ActionScope>) -> Result<(), Error> {
        // Service identity is supplied by Host's native call stack. Neither an
        // app nor the Tokens prompt may declare itself the native publisher.
        if !valid_publisher(&client::get_sender()) {
            return Err(error("only native Transact may seal approvals"));
        }
        let table = staged();
        let scope = table
            .get("scope")
            .map(|b| psio::from_pssz::<TransferScope>(&b).unwrap())
            .ok_or_else(|| error("no active wallet transfer scope"))?;
        let user = Accounts::get_current_user()
            .ok_or_else(|| error("selected user changed before submission"))?;
        let active_app = client::get_active_app();
        if !valid_expected_user(&user, &scope.user)
            || !valid_scope(&active_app, &user, &scope.caller, &scope.caller)
            || !valid_token_senders(
                &user,
                actions
                    .iter()
                    .map(|a| (a.sender.as_str(), a.service.as_str())),
            )
        {
            return Err(error(
                "signed token actions do not match the reviewed wallet account",
            ));
        }
        let senders: Vec<String> = actions
            .into_iter()
            .filter(|a| a.service == "tokens")
            .map(|a| a.sender)
            .collect();
        let references = table
            .get("pending")
            .map(|b| psio::from_pssz::<Vec<PromptRef>>(&b).unwrap())
            .unwrap_or_default();
        if references.is_empty() {
            return Ok(());
        }
        if references.len() > MAX_PENDING {
            return Err(error("too many staged transfer approvals"));
        }
        let key = format!("{user}:{active_app}");
        let mut pending = requests(&key);
        let mut indices = std::collections::BTreeSet::new();
        let time = now();
        // Validate the complete set first, before any nontransactional writes.
        for reference in &references {
            if reference.key != key {
                return Err(error("staged transfer user or app changed"));
            }
            let index = pending
                .iter()
                .position(|r| r.id == reference.id)
                .ok_or_else(|| error("staged transfer review disappeared"))?;
            if !indices.insert(index)
                || !pending[index].can_seal(
                    &active_app,
                    &user,
                    &senders,
                    time,
                    was_consumed(&key, reference.id),
                )
            {
                return Err(error(
                    "staged transfer approval is invalid, expired, or already spent",
                ));
            }
        }
        seal_global_approvals(&key, &pending, &indices, time)?;
        for index in indices {
            pending[index].sealed = true;
        }
        // This write is immediate and survives RPC rejection, timeout, a lost
        // response, and client shutdown. A new review is required for any retry.
        save(&key, &pending);
        staged().delete("pending");
        Ok(())
    }
}

impl TransferAdmin for TokensPlugin {
    fn get_context() -> Result<String, Error> {
        let (_, pending, index) = prompt_request(None)?;
        let request = &pending[index];
        let token = query::fetch_token::fetch_token(request.intent.token_id)?;
        let operation = ["credit", "uncredit", "debit"][request.intent.operation as usize];
        Ok(serde_json::json!({
            "requestId": request.id.to_string(), "user": request.intent.user,
            "caller": request.intent.caller, "counterparty": request.intent.counterparty,
            "operation": operation,
            "tokenId": request.intent.token_id, "symbol": token.symbol.map(|s| s.to_string()),
            "amount": Decimal::new(Quantity::from(request.intent.amount), token.precision).to_string(),
            "memo": request.intent.memo,
        }).to_string())
    }
    fn approve(request_id: String, remember: bool) -> Result<(), Error> {
        let (key, mut pending, index) = prompt_request(Some(&request_id))?;
        pending[index].approved = true;
        save(&key, &pending);
        if remember {
            trusts().set(&key, &[1]);
        }
        Ok(())
    }
    fn deny(request_id: String) -> Result<(), Error> {
        let (key, mut pending, index) = prompt_request(Some(&request_id))?;
        pending[index].approved = false;
        pending[index].denied = true;
        save(&key, &pending);
        Ok(())
    }
}
