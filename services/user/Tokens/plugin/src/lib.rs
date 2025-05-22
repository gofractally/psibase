#[allow(warnings)]
mod bindings;

use bindings::exports::tokens::plugin::intf::Guest as Intf;
use bindings::exports::tokens::plugin::queries::Guest as Queries;
use bindings::exports::tokens::plugin::transfer::Guest as Transfer;
use bindings::exports::tokens::plugin::types as Types;

use bindings::host::common::types::Error;
use bindings::transact::plugin::intf::add_action_to_transaction;

use psibase::fracpack::Pack;

mod errors;
use errors::ErrorType;
use psibase::Quantity;

pub mod query {
    pub mod fetch_token;
}

struct TokensPlugin;

impl Intf for TokensPlugin {
    fn create(precision: u8, max_supply: String) -> Result<(), Error> {
        let max_supply = Quantity::from_str(&max_supply, precision.into()).unwrap();

        let packed_args = tokens::action_structs::create {
            max_supply,
            precision,
        }
        .packed();

        add_action_to_transaction(tokens::action_structs::create::ACTION_NAME, &packed_args)
    }

    fn burn(token_id: String, amount: String, memo: String, account: String) -> Result<(), Error> {
        if (account.len() as u8) == 0 {
            //
        } else {
            // add_action_to_transaction(tokens::action_structs::burn, packed_args)
        }

        Ok(())
    }

    fn mint(
        token_id: String,
        amount: String,
        memo: String,
    ) -> Result<(), bindings::exports::tokens::plugin::intf::Error> {
        Ok(())
    }
}

impl Transfer for TokensPlugin {
    fn credit(
        token_id: String,
        account: String,
        amount: String,
        memo: String,
    ) -> Result<(), Error> {
        // build the asset?

        Ok(())
    }

    fn debit(
        token_id: String,
        creditor: String,
        amount: String,
        memo: String,
    ) -> Result<(), Error> {
        Ok(())
    }

    fn uncredit(
        token_id: String,
        creditor: String,
        amount: String,
        memo: String,
    ) -> Result<(), Error> {
        Ok(())
    }
}

impl Queries for TokensPlugin {
    fn token_owner(token_id: String) -> Result<Types::TokenDetail, Error> {
        let token = query::fetch_token::fetch_token(token_id)?;

        Ok(Types::TokenDetail {
            id: token.id,
            owner: token.owner.to_string(),
            symbol_id: "fwep".to_string(),
            precision: token.precision,
            current_supply: token.current_supply.to_string(),
            max_supply: token.max_supply.to_string(),
        })
    }
}

bindings::export!(TokensPlugin with_types_in bindings);
