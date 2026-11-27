//! Native wallet boundary. No private keys, sender override, admin or arbitrary action API.
#[allow(warnings)]
mod bindings;
use bindings::exports::btcbridge::plugin::api::Guest;
use bindings::host::types::types::Error;
use bindings::transact::plugin::api::add_action_to_transaction;

use serde::Deserialize;
use serde_json::Value;
psibase::define_trust! {
    descriptions { Low => "", Medium => "", High => "Create Bitcoin deposit addresses, authorize BTC withdrawals, cancel your queued withdrawals, and relay Bitcoin proofs using your connected Psibase account", }
    functions { High => [submit], }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Action {
    sender: String,
    service: String,
    method: String,
    data: Value,
}
fn error(message: impl ToString) -> Error {
    Error {
        code: 1,
        producer: bindings::host::types::types::PluginId {
            service: "btcbridge".into(),
            plugin: "plugin".into(),
        },
        message: message.to_string(),
    }
}
fn decimal(n: u64) -> String {
    format!("{}.{:08}", n / 100_000_000, n % 100_000_000)
}
struct Plugin;
impl Guest for Plugin {
    fn submit(actions: String) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::submit)?;
        let user = bindings::host::accounts::api::get_current_user()
            .ok_or_else(|| error("Connect a Psibase account"))?;
        let account = bindings::accounts::query::api::get_account(&user)?
            .ok_or_else(|| error("Account no longer exists"))?;
        if account.auth_service != "auth-sig" {
            return Err(error("A key-secured Psibase account is required"));
        }
        let actions: Vec<Action> = serde_json::from_str(&actions).map_err(error)?;
        if actions.is_empty() || actions.len() > 8 {
            return Err(error("Invalid action count"));
        }
        // Transact selects and signs
        // the current account; the caller cannot override its sender or signing authority.
        for a in actions {
            if a.sender != user {
                return Err(error("Connected account changed"));
            }
            if a.service == "btcrelay" && a.method == "headers" {
                let args: btcrelay::action_structs::headers =
                    serde_json::from_value(a.data).map_err(error)?;
                bindings::btcrelay::plugin::api::headers(&args.headers)?;
                continue;
            }
            if a.service == "btcrelay" && a.method == "signetHeaders" {
                let args: btcrelay::action_structs::signetHeaders =
                    serde_json::from_value(a.data).map_err(error)?;
                let blocks: Vec<_> = args
                    .blocks
                    .into_iter()
                    .map(|b| bindings::btcrelay::plugin::api::SignetBlock {
                        header: b.header,
                        coinbase: b.coinbase,
                        branch: b.branch,
                    })
                    .collect();
                bindings::btcrelay::plugin::api::signet_headers(&blocks)?;
                continue;
            }
            if a.service == "tokens" {
                let token = a.data["token_id"]
                    .as_u64()
                    .and_then(|n| u32::try_from(n).ok())
                    .ok_or_else(|| error("Invalid token"))?;
                let amount = a.data["amount"]["value"]
                    .as_u64()
                    .ok_or_else(|| error("Invalid amount"))?;
                let memo = a.data["memo"].as_str().unwrap_or_default();
                let snapshot = bindings::host::http::api::get_json("/snapshot")?;
                if snapshot.len() > 2_000_000 {
                    return Err(error("Bridge snapshot exceeds limit"));
                }
                let snapshot: Value = serde_json::from_str(&snapshot).map_err(error)?;
                if snapshot["config"]["token"].as_u64() != Some(u64::from(token)) {
                    return Err(error("Only the bridge BTC token is supported"));
                }
                match a.method.as_str() {
                    "debit" if a.data["creditor"] == "btcbridge" => {
                        bindings::tokens::plugin::user::debit(
                            token,
                            "btcbridge",
                            &decimal(amount),
                            memo,
                        )?
                    }
                    "credit" if a.data["debitor"] == "btcbridge" => {
                        let receiver = a.data["debitor"]
                            .as_str()
                            .ok_or_else(|| error("Missing recipient"))?;
                        bindings::tokens::plugin::user::credit(
                            token,
                            receiver,
                            &decimal(amount),
                            memo,
                        )?;
                    }
                    _ => return Err(error("Unsupported token action")),
                }
                continue;
            }
            if a.service != "btcbridge" {
                return Err(error("Unsupported service"));
            }
            macro_rules! pack { ($($name:ident),* $(,)?) => { match a.method.as_str() {
                $(stringify!($name) => psio::to_pssz(&serde_json::from_value::<btcbridge::action_structs::$name>(a.data).map_err(error)?),)*
                _ => return Err(error("Unsupported bridge action")),
            } }; }
            let packed = pack!(
                newAddress,
                withdraw,
                cancel,
                makeBatch,
                requestSigs,
                gather,
                complete,
                deposit,
                bump,
                reportSpend,
                indexDeps
            );
            add_action_to_transaction(&a.method, &packed)?;
        }
        Ok(())
    }
}
bindings::export!(Plugin with_types_in bindings);
