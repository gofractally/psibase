#[allow(warnings)]
mod bindings;
use std::str::FromStr;

use bindings::*;
mod errors;
use errors::ErrorType::*;
use exports::auth_delegate::plugin::api::{Error, Guest as Api};
use exports::auth_delegate::plugin::session::Guest as Session;
use transact::plugin::intf::add_action_to_transaction;

use crate::trust::*;
use psibase::fracpack::Pack;
use psibase::*;

psibase::define_trust! {
    descriptions {
        Low => "",
        Medium => "
            - Create new accounts owned by you
        ",
        High => "
            - Set the owner of your account

        Warning: This will grant the caller the ability to control how your account is authorized, including the capability to take control of your account! Make sure you completely trust the caller's legitimacy.
        ",
    }
    functions {
        None => [],
        Low => [],
        Medium => [new_account],
        High => [set_owner],
    }
}

struct AuthDelegate;

fn get_account_number(name: &str) -> Result<AccountNumber, Error> {
    AccountNumber::from_str(name).map_err(|_| Error::from(InvalidAccountName))
}

impl Session for AuthDelegate {
    fn authorize(_account_name: String) -> Result<(), Error> {
        Err(NotYetImplemented("session::authorize"))?
    }

    fn login(_account_name: String) -> Result<(), Error> {
        Err(NotYetImplemented("session::login"))?
    }
}

impl Api for AuthDelegate {
    fn set_owner(owner: String) -> Result<(), Error> {
        use psibase::services::auth_delegate::action_structs::setOwner as set_owner_action;

        assert_authorized_with_whitelist(FunctionName::set_owner, vec!["workshop".into()])?;

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

        assert_authorized_with_whitelist(FunctionName::new_account, vec!["workshop".into()])?;

        let new_account = new_account_action {
            name: get_account_number(name.as_str())?,
            owner: get_account_number(owner.as_str())?,
            require_match: true,
        };
        Ok(add_action_to_transaction(
            new_account_action::ACTION_NAME,
            &new_account.packed(),
        )?)
    }
}

bindings::export!(AuthDelegate with_types_in bindings);
