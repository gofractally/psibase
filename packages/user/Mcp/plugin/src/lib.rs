#[allow(warnings)]
mod bindings;

use bindings::accounts::plugin::api as AccountsApi;
use bindings::auth_sig::plugin as AuthSig;
use bindings::exports::mcp::plugin::agent_sign::Guest as AgentSign;
use bindings::exports::mcp::plugin::approvals::Guest as Approvals;
use bindings::exports::mcp::plugin::setup::Guest as Setup;
use bindings::exports::transact_hook_user_auth::{Claim, Guest as HookUserAuth, Proof};
use bindings::host::accounts::admin::{self as HostAccountsAdmin, Credential};
use bindings::host::accounts::api as HostAccountsApi;
use bindings::host::client::api as Client;
use bindings::host::http::api as Server;
use bindings::host::types::types::{Error, Pem};
use bindings::profiles::plugin::api as Profiles;
use bindings::profiles::plugin::types::Profile as PluginProfile;
use bindings::staged_tx::plugin::respondent as StagedTx;
use bindings::tokens::plugin::user_config as TokensUserConfig;
use bindings::transact::plugin::api::{add_action_to_transaction, propose, set_propose_latch};
use bindings::transact::plugin::types::Action as TxAction;
use mcp::action_structs::*;
use psibase::fracpack::Pack;
use psibase::AccountNumber;
use serde::Deserialize;

psibase::plugin_error! {
    pub ErrorType
    Unauthorized(app: String) => "Only the mcp app may call this plugin (caller: {app})",
    InvalidAccount(name: String) => "Invalid account name: {name}",
    QueryFailed(msg: String) => "query failed: {msg}",
    BadActions(msg: String) => "invalid actions JSON: {msg}",
    ImportFailed(msg: String) => "import-agent failed: {msg}",
    HexDecode(msg: String) => "hex decode failed: {msg}",
}

fn only_mcp_app() -> Result<(), Error> {
    let caller = Client::get_sender();
    if caller != "mcp" {
        return Err(ErrorType::Unauthorized(caller).into());
    }
    Ok(())
}

fn account(name: &str) -> Result<AccountNumber, Error> {
    AccountNumber::from_exact(name).map_err(|_| ErrorType::InvalidAccount(name.to_string()).into())
}

fn decode_hex(s: &str) -> Result<Vec<u8>, Error> {
    let s = s.trim().strip_prefix("0x").unwrap_or(s.trim());
    if s.len() % 2 != 0 {
        return Err(ErrorType::HexDecode("odd length".into()).into());
    }
    (0..s.len())
        .step_by(2)
        .map(|i| {
            u8::from_str_radix(&s[i..i + 2], 16)
                .map_err(|e| ErrorType::HexDecode(e.to_string()).into())
        })
        .collect()
}

#[derive(Deserialize)]
struct ActionJson {
    service: String,
    method: String,
    #[serde(rename = "rawData")]
    raw_data: String,
}

struct McpPlugin;

impl Approvals for McpPlugin {
    fn needs_approval() -> Result<String, Error> {
        only_mcp_app()?;
        let query = format!(
            r#"query {{ needsApproval {{
                pending {{ account id txid proposer actions {{ sender service method rawData }} }}
                missing
            }} }}"#
        );
        let body = Server::post_graphql_get_json(&query)?;
        let v: serde_json::Value =
            serde_json::from_str(&body).map_err(|e| ErrorType::QueryFailed(e.to_string()))?;
        if let Some(errs) = v.get("errors") {
            return Err(ErrorType::QueryFailed(errs.to_string()).into());
        }
        Ok(v["data"]["needsApproval"].to_string())
    }

    fn approve(account_name: String, id: u32) -> Result<(), Error> {
        only_mcp_app()?;
        let account = account(&account_name)?;
        StagedTx::accept(id)?;
        add_action_to_transaction(untrack::ACTION_NAME, &untrack { account, id }.packed())
    }

    fn approve_and_grant(account_name: String, id: u32) -> Result<(), Error> {
        only_mcp_app()?;
        let account = account(&account_name)?;
        add_action_to_transaction(
            grant_missing::ACTION_NAME,
            &grant_missing { account, id }.packed(),
        )?;
        StagedTx::accept(id)
    }
}

impl Setup for McpPlugin {
    fn create_agent_account(agent_name: String) -> Result<Pem, Error> {
        only_mcp_app()?;
        account(&agent_name)?;
        AuthSig::actions::create_account(&agent_name)
    }

    fn confirm_agent_key(agent_name: String, private_key: Pem) -> Result<bool, Error> {
        only_mcp_app()?;
        account(&agent_name)?;
        Ok(AuthSig::api::can_authorize(&private_key, &agent_name))
    }

    fn bootstrap(agent_name: String) -> Result<(), Error> {
        only_mcp_app()?;
        let agent = account(&agent_name)?;
        HostAccountsApi::get_current_user()
            .ok_or_else(|| ErrorType::ImportFailed("not logged in".into()))?;
        // Same tx, owner-signed: register the agent first (canAuthUserSys
        // requires it), then make mcp the owner's auth service.
        add_action_to_transaction(bootstrap::ACTION_NAME, &bootstrap { agent }.packed())?;
        AccountsApi::set_auth_service(&mcp::SERVICE.to_string())
    }

    fn current_user() -> Result<String, Error> {
        only_mcp_app()?;
        HostAccountsApi::get_current_user()
            .ok_or_else(|| ErrorType::ImportFailed("not logged in".into()).into())
    }

    fn enable_agent_auto_debit(agent_name: String, agent_key: Pem) -> Result<(), Error> {
        only_mcp_app()?;
        account(&agent_name)?;
        let cred = Credential {
            account: agent_name.clone(),
            key: agent_key,
        };
        HostAccountsAdmin::import_existing(&[cred]).map_err(|errs| -> Error {
            let msg = errs
                .into_iter()
                .map(|(a, e)| format!("{a}: {}", e.message))
                .collect::<Vec<_>>()
                .join("; ");
            ErrorType::ImportFailed(msg).into()
        })?;
        HostAccountsAdmin::add_connected_app(&agent_name, "mcp");
        HostAccountsAdmin::login(&agent_name, "mcp")?;
        TokensUserConfig::enable_user_auto_debit(true)?;
        Ok(())
    }

    fn restore_parent(parent: String) -> Result<(), Error> {
        only_mcp_app()?;
        account(&parent)?;
        HostAccountsAdmin::login(&parent, "mcp")
    }

    fn my_agents() -> Result<String, Error> {
        only_mcp_app()?;
        let query = r#"query { myAgents { account agent } }"#;
        let body = Server::post_graphql_get_json(query)?;
        let v: serde_json::Value =
            serde_json::from_str(&body).map_err(|e| ErrorType::QueryFailed(e.to_string()))?;
        if let Some(errs) = v.get("errors") {
            return Err(ErrorType::QueryFailed(errs.to_string()).into());
        }
        Ok(v["data"]["myAgents"].to_string())
    }
}

impl AgentSign for McpPlugin {
    fn import_agent(account_name: String, private_key: Pem) -> Result<(), Error> {
        only_mcp_app()?;
        account(&account_name)?;
        let cred = Credential {
            account: account_name.clone(),
            key: private_key,
        };
        HostAccountsAdmin::import_existing(&[cred]).map_err(|errs| -> Error {
            let msg = errs
                .into_iter()
                .map(|(a, e)| format!("{a}: {}", e.message))
                .collect::<Vec<_>>()
                .join("; ");
            ErrorType::ImportFailed(msg).into()
        })?;
        HostAccountsAdmin::add_connected_app(&account_name, "mcp");
        HostAccountsAdmin::login(&account_name, "mcp")?;
        Ok(())
    }

    fn propose_as(owner: String, actions_json: String) -> Result<u32, Error> {
        only_mcp_app()?;
        account(&owner)?;
        let parsed: Vec<ActionJson> = serde_json::from_str(&actions_json)
            .map_err(|e| ErrorType::BadActions(e.to_string()))?;
        if parsed.is_empty() {
            return Err(ErrorType::BadActions("empty actions".into()).into());
        }
        let mut actions = Vec::with_capacity(parsed.len());
        for a in parsed {
            account(&a.service)?;
            actions.push(TxAction {
                sender: owner.clone(),
                service: a.service,
                method: a.method,
                raw_data: decode_hex(&a.raw_data)?,
            });
        }
        // WIT propose returns (); covered txs auto-execute via implicit accept.
        // Callers that need a staged id query staged-tx afterward.
        propose(&actions, true)?;
        Ok(0)
    }

    fn propose_set_profile(owner: String, display_name: String, bio: String) -> Result<(), Error> {
        only_mcp_app()?;
        account(&owner)?;
        // Same latch pattern as Homepage / Host LoginPrompt: actions added while
        // latched become a staged-tx propose by the logged-in agent with `owner`
        // as sender.
        set_propose_latch(Some(&owner))?;
        let result = Profiles::set_profile(&PluginProfile {
            display_name: Some(display_name),
            bio: Some(bio),
        });
        set_propose_latch(None)?;
        result
    }

    fn track(id: u32) -> Result<(), Error> {
        only_mcp_app()?;
        add_action_to_transaction(track::ACTION_NAME, &track { id }.packed())
    }
}

/// `mcp` is the owner's auth service; the owner's key is still the auth-sig
/// key, so the claim and proof are exactly what auth-sig would produce.
impl HookUserAuth for McpPlugin {
    fn on_user_auth_claim(account_name: String) -> Result<Option<Claim>, Error> {
        if Client::get_sender() != psibase::services::transact::SERVICE.to_string() {
            return Err(ErrorType::Unauthorized(Client::get_sender()).into());
        }
        let Some(pubkey) = AuthSig::queries::get_pubkey(&account_name)? else {
            return Err(
                ErrorType::QueryFailed(format!("{account_name} has no auth-sig key")).into(),
            );
        };
        Ok(Some(Claim {
            verify_service: psibase::services::verify_sig::SERVICE.to_string(),
            raw_data: AuthSig::keyvault::to_der(&pubkey)?,
        }))
    }

    fn on_user_auth_proof(
        account_name: String,
        transaction_hash: Vec<u8>,
    ) -> Result<Option<Proof>, Error> {
        if Client::get_sender() != psibase::services::transact::SERVICE.to_string() {
            return Err(ErrorType::Unauthorized(Client::get_sender()).into());
        }
        let Some(pubkey) = AuthSig::queries::get_pubkey(&account_name)? else {
            return Err(
                ErrorType::QueryFailed(format!("{account_name} has no auth-sig key")).into(),
            );
        };
        let der = AuthSig::keyvault::to_der(&pubkey)?;
        let signature = AuthSig::keyvault::sign(&transaction_hash, &der)?;
        Ok(Some(Proof { signature }))
    }
}

bindings::export!(McpPlugin with_types_in bindings);
