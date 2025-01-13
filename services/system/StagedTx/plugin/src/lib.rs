#[allow(warnings)]
mod bindings;

use bindings::accounts::plugin::api::get_account;
use bindings::clientdata::plugin::keyvalue as Keyvalue;
use bindings::exports::staged_tx::plugin::admin::Guest as Admin;
use bindings::exports::staged_tx::plugin::api::Guest as Api;
use bindings::host::common::client as Client;
use bindings::host::common::types::Error;

mod errors;
use errors::ErrorType;

pub struct DbKeys;

impl DbKeys {
    pub const LATCH: &'static str = "latch";
    pub const PROPOSE_MODE: &'static str = "propose-mode";
}

fn validate_account(account: &str) -> Result<(), Error> {
    match get_account(account) {
        Ok(Some(_)) => Ok(()),
        Ok(None) => Err(ErrorType::InvalidAccount(account.to_string()).into()),
        Err(e) => Err(e),
    }
}

struct Latch;

impl Latch {
    fn set(account: String) -> Result<(), Error> {
        validate_account(&account)?;
        Keyvalue::set(DbKeys::LATCH, account.as_bytes()).expect("Failed to set latch");
        Ok(())
    }

    fn unset() {
        Keyvalue::delete(DbKeys::LATCH);
    }

    fn get() -> Option<String> {
        Keyvalue::get(DbKeys::LATCH).map(|v| String::from_utf8(v).unwrap())
    }
}

struct ProposeMode;

impl ProposeMode {
    fn get_key(proposer: &str) -> String {
        format!("{}.{}", DbKeys::PROPOSE_MODE, proposer)
    }

    fn set(proposer: String, account: String) -> Result<(), Error> {
        validate_account(&proposer)?;
        validate_account(&account)?;
        Keyvalue::set(&Self::get_key(&proposer), account.as_bytes())
            .expect("Failed to set propose mode");
        Ok(())
    }

    fn unset(proposer: &str) {
        Keyvalue::delete(&Self::get_key(proposer));
    }

    fn get(proposer: &str) -> Option<String> {
        Keyvalue::get(&Self::get_key(proposer)).map(|v| String::from_utf8(v).unwrap())
    }
}

fn get_assert_caller(context: &str, allowed_apps: &[&str]) -> Result<(), Error> {
    let caller = Client::get_sender_app();
    let caller_app = caller.app.as_ref().unwrap();
    if caller.app.is_none() || !allowed_apps.contains(&caller_app.as_str()) {
        return Err(ErrorType::Unauthorized(context.to_string(), caller_app.to_string()).into());
    }
    Ok(())
}

struct StagedTxPlugin;

impl StagedTxPlugin {
    fn transact_service() -> String {
        psibase::services::transact::SERVICE.to_string()
    }

    fn homepage_service() -> String {
        psibase::services::http_server::HOMEPAGE_SERVICE.to_string()
    }
}

impl Admin for StagedTxPlugin {
    fn enable_proposal_mode(proposer: String, account: String) -> Result<(), Error> {
        get_assert_caller(
            "enable_proposal_mode",
            &vec![Self::homepage_service().as_str()],
        )?;
        ProposeMode::set(proposer, account)
    }

    fn disable_proposal_mode(proposer: String) -> Result<(), Error> {
        get_assert_caller(
            "disable_proposal_mode",
            &vec![Self::homepage_service().as_str()],
        )?;
        validate_account(&proposer)?;
        ProposeMode::unset(&proposer);
        Ok(())
    }

    fn unset_propose_latch() {
        get_assert_caller("unset_propose_latch", &[Self::transact_service().as_str()])
            .expect("Failed authorization check");
        Latch::unset();
    }

    fn get_propose_latch(proposer: String) -> Option<String> {
        get_assert_caller("get_propose_latch", &[Self::transact_service().as_str()])
            .expect("Failed authorization check");
        Latch::get().or(ProposeMode::get(&proposer))
    }
}

impl Api for StagedTxPlugin {
    fn set_propose_latch(account: String) -> Result<(), Error> {
        // TODO: Should restrict to only be allowed to be called by the
        //       currently active application?
        Latch::set(account)
    }
}

bindings::export!(StagedTxPlugin with_types_in bindings);
