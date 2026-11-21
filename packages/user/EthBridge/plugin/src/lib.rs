//! Native wallet boundary: no sender overrides, admin actions or custody keys.
#[allow(warnings)]
mod bindings;
use bindings::{exports::ethbridge::plugin::api::Guest, host::types::types::Error};
use psibase::fracpack::Pack;
use serde::Deserialize;
use serde_json::Value;
psibase::define_trust! {descriptions{Low=>"",Medium=>"",High=>"Publish Ethereum proofs, authorize ETH withdrawals, cancel queued withdrawals, and coordinate finalized ETH batches using your connected Psibase account",}functions{High=>[submit,prove],None=>[identity],}}
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
            service: "ethbridge".into(),
            plugin: "plugin".into(),
        },
        message: message.to_string(),
    }
}
fn current() -> Result<String, Error> {
    let user = bindings::host::accounts::api::get_current_user()
        .ok_or_else(|| error("Connect a Psibase account"))?;
    let account = bindings::accounts::query::api::get_account(&user)?
        .ok_or_else(|| error("Unknown Psibase account"))?;
    if account.auth_service != "auth-sig" {
        return Err(error("A key-secured Psibase account is required"));
    }
    Ok(user)
}
fn decimal(n: u64) -> String {
    format!("{}.{:08}", n / 100_000_000, n % 100_000_000)
}
struct Plugin;
impl Guest for Plugin {
    fn identity() -> Result<String, Error> {
        let user = current()?;
        let account: psibase::AccountNumber = user.parse().map_err(error)?;
        Ok(serde_json::json!({"account":user,"number":account.value.to_string()}).to_string())
    }
    fn prove(submission: String) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::prove)?;
        let _user = current()?;
        if submission.len() > 262144 {
            return Err(error("Evidence submission size limit"));
        }
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Submission {
            fact: ethrelay_core::Fact,
            witness: ethrelay_core::Witness,
            block: Option<String>,
            batch: Option<u64>,
            child: Option<String>,
        }
        let s: Submission = serde_json::from_str(&submission).map_err(error)?;
        use ethrelay_core::{Fact, Witness};
        if !matches!(
            (&s.fact, &s.witness),
            (Fact::Update(_), Witness::Update(_))
                | (Fact::Header(_), Witness::Header(_))
                | (Fact::Receipt(_), Witness::Receipt(_))
        ) {
            return Err(error("Unsupported or mismatched public Ethereum evidence"));
        }
        let proof = serde_json::to_vec(&s.witness).map_err(error)?;
        if proof.len() > ethrelay_core::MAX_WITNESS {
            return Err(error("Ethereum witness size limit"));
        }
        let fact_json = serde_json::to_string(&s.fact).map_err(error)?;
        if fact_json.len() > 32768 {
            return Err(error("Ethereum fact size limit"));
        }
        let commitment = s.fact.commitment().to_vec();
        let (method, args) = match s.fact {
            Fact::Update(_) | Fact::Header(_) => (
                "relay",
                ethbridge::action_structs::relay {
                    fact_json,
                    child: s.child,
                }
                .packed(),
            ),
            Fact::Receipt(_) => {
                let block = s.block.ok_or_else(|| error("Receipt block required"))?;
                if let Some(batch) = s.batch {
                    (
                        "complete",
                        ethbridge::action_structs::complete {
                            batch,
                            block,
                            fact_json,
                        }
                        .packed(),
                    )
                } else {
                    (
                        "deposit",
                        ethbridge::action_structs::deposit { block, fact_json }.packed(),
                    )
                }
            }
            _ => {
                return Err(error(
                    "Administrative Ethereum evidence is not a browser operation",
                ))
            }
        };
        bindings::transact::plugin::api::add_evidence(
            &bindings::transact::plugin::types::Claim {
                verify_service: "verify-eth".into(),
                raw_data: commitment,
            },
            &proof,
        )?;
        bindings::transact::plugin::api::add_action_to_transaction(method, &args)
    }

    fn submit(actions: String) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::submit)?;
        let user = current()?;
        if actions.len() > 32768 {
            return Err(error("ETH action size limit"));
        }
        let actions: Vec<Action> = serde_json::from_str(&actions).map_err(error)?;
        if actions.is_empty() || actions.len() > 8 {
            return Err(error("ETH action count limit"));
        }
        for a in actions {
            if a.sender != user {
                return Err(error("Connected account changed"));
            }
            if a.service == "tokens" {
                let token = a.data["token_id"]
                    .as_u64()
                    .and_then(|n| u32::try_from(n).ok())
                    .ok_or_else(|| error("Invalid token"))?;
                let amount = a.data["amount"]["value"]
                    .as_u64()
                    .ok_or_else(|| error("Invalid token amount"))?;
                let state: Value =
                    serde_json::from_str(&bindings::host::http::api::get_json("/snapshot")?)
                        .map_err(error)?;
                if state["config"]["token"].as_u64() != Some(u64::from(token)) {
                    return Err(error("Only the bridge ETH token is supported"));
                }
                let memo = a.data["memo"].as_str().unwrap_or_default();
                match a.method.as_str() {
                    "credit" if a.data["debitor"] == "ethbridge" => {
                        bindings::tokens::plugin::user::credit(
                            token,
                            "ethbridge",
                            &decimal(amount),
                            memo,
                        )?
                    }
                    "debit" if a.data["creditor"] == "ethbridge" => {
                        bindings::tokens::plugin::user::debit(
                            token,
                            "ethbridge",
                            &decimal(amount),
                            memo,
                        )?
                    }
                    _ => return Err(error("Unsupported ETH token action")),
                }
                continue;
            }
            if a.service != "ethbridge" {
                return Err(error("Unsupported ETH service"));
            }
            macro_rules! add {
                ($method:ident) => {{
                    let args: ethbridge::action_structs::$method =
                        serde_json::from_value(a.data).map_err(error)?;
                    bindings::transact::plugin::api::add_action_to_transaction(
                        stringify!($method),
                        &args.packed(),
                    )?;
                }};
            }
            match a.method.as_str() {
                "withdraw" => add!(withdraw),
                "cancel" => add!(cancel),
                "makeBatch" => add!(makeBatch),
                "gather" => add!(gather),
                _ => return Err(error("Unsupported ETH bridge action")),
            }
        }
        Ok(())
    }
}
bindings::export!(Plugin with_types_in bindings);
