#[allow(warnings)]
mod bindings;
use std::str::FromStr;

use bindings::*;
mod errors;
use errors::ErrorType::*;
use exports::auth_delegate::plugin::api::{Error, Guest as Api};
use exports::transact_hook_user_auth::{Claim, Guest as HookUserAuth, Proof};
use host::common::client as Client;
use transact::plugin::intf::add_action_to_transaction;

use psibase::fracpack::Pack;
use psibase::*;

struct AuthDelegate;

// TODO: User oauth when available
fn assert_caller_admin(context: &str) {
    assert!(
        Client::get_sender() == psibase::services::auth_delegate::SERVICE.to_string(),
        "'{}' only callable from 'auth-delegate' app",
        context
    );
}

fn get_account_number(name: &str) -> Result<AccountNumber, Error> {
    AccountNumber::from_str(name).map_err(|_| Error::from(InvalidAccountName))
}

impl HookUserAuth for AuthDelegate {
    fn on_user_auth_claim(_account_name: String) -> Result<Option<Claim>, Error> {
        Err(NotYetImplemented("get_claims"))?
    }

    fn on_user_auth_proof(
        _account_name: String,
        _transaction_hash: Vec<u8>,
    ) -> Result<Option<Proof>, Error> {
        Err(NotYetImplemented("get_proofs"))?
    }
}

impl Api for AuthDelegate {
    fn set_owner(owner: String) -> Result<(), Error> {
        use psibase::services::auth_delegate::action_structs::setOwner as set_owner_action;

        assert_caller_admin("set_owner");

        let set_owner = set_owner_action {
            owner: get_account_number(owner.as_str())?,
        };
        Ok(add_action_to_transaction(
            set_owner_action::ACTION_NAME,
            &set_owner.packed(),
        )?)
    }

    fn new_account(name: String, owner: String) -> Result<(), Error> {
        use psibase::services::auth_delegate::action_structs::newAccount as new_account_action;

        assert_caller_admin("new_account");

        let new_account = new_account_action {
            name: get_account_number(name.as_str())?,
            owner: get_account_number(owner.as_str())?,
        };
        Ok(add_action_to_transaction(
            new_account_action::ACTION_NAME,
            &new_account.packed(),
        )?)
    }
}

bindings::export!(AuthDelegate with_types_in bindings);
