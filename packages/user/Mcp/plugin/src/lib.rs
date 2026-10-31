#[allow(warnings)]
mod bindings;

use bindings::exports::mcp::plugin::approvals::Guest as Approvals;
use bindings::host::client::api as Client;
use bindings::host::http::api as Server;
use bindings::host::types::types::Error;
use bindings::staged_tx::plugin::respondent as StagedTx;
use bindings::transact::plugin::api::add_action_to_transaction;
use mcp::action_structs::*;
use psibase::fracpack::Pack;
use psibase::AccountNumber;

psibase::plugin_error! {
    pub ErrorType
    Unauthorized(app: String) => "Only the mcp app may call this plugin (caller: {app})",
    InvalidAccount(name: String) => "Invalid account name: {name}",
    QueryFailed(msg: String) => "needsApproval query failed: {msg}",
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

struct McpPlugin;

impl Approvals for McpPlugin {
    fn needs_approval() -> Result<String, Error> {
        only_mcp_app()?;
        // No owner argument: r-mcp uses the query token's account, so this
        // only ever returns the logged-in user's own list.
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

bindings::export!(McpPlugin with_types_in bindings);
