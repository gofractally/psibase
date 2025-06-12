#[allow(warnings)]
mod bindings;

use std::str::FromStr;

use bindings::exports::tokens::plugin::intf::Guest as Intf;
use bindings::exports::tokens::plugin::queries::Guest as Queries;
use bindings::exports::tokens::plugin::transfer::Guest as Transfer;
use bindings::exports::tokens::plugin::types as Types;

use bindings::host::common::types::Error;
use bindings::transact::plugin::intf::add_action_to_transaction;

use psibase::fracpack::Pack;

mod errors;
use errors::ErrorType;
use psibase::{AccountNumber, Quantity};

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
        let token = query::fetch_token::fetch_token(token_id)?;
        let from = AccountNumber::from_str(account.as_str()).unwrap();

        let amount = Quantity::from_str(&amount, 4.into()).unwrap();

        let packed_args = tokens::action_structs::recall {
            amount,
            from,
            memo,
            token_id: token.id,
        }
        .packed();
        add_action_to_transaction(tokens::action_structs::recall::ACTION_NAME, &packed_args)
    }

    fn map_symbol(symbol: String) -> Result<(), Error> {
        let packed_args = tokens::action_structs::map_symbol {
            token_id: 2,
            symbol_id: AccountNumber::from_str(symbol.as_str()).unwrap(),
        }
        .packed();
        add_action_to_transaction(
            tokens::action_structs::map_symbol::ACTION_NAME,
            &packed_args,
        )
    }

    fn mint(token_id: String, amount: String, memo: String) -> Result<(), Error> {
        let token = query::fetch_token::fetch_token(token_id)?;

        let amount = Quantity::from_str(&amount, token.precision.into()).unwrap();

        let packed_args = tokens::action_structs::mint {
            amount,
            memo,
            token_id: token.id,
        }
        .packed();
        add_action_to_transaction(tokens::action_structs::mint::ACTION_NAME, &packed_args)
    }
}

impl Transfer for TokensPlugin {
    fn credit(
        token_id: String,
        debitor: String,
        amount: String,
        memo: String,
    ) -> Result<(), Error> {
        let token = query::fetch_token::fetch_token(token_id)?;

        let amount = Quantity::from_str(&amount, token.precision.into()).unwrap();

        let debitor = AccountNumber::from_str(debitor.as_str()).unwrap();

        let packed_args = tokens::action_structs::credit {
            amount,
            memo,
            debitor,
            token_id: token.id,
        }
        .packed();

        add_action_to_transaction(tokens::action_structs::credit::ACTION_NAME, &packed_args)
    }

    fn debit(
        token_id: String,
        creditor: String,
        amount: String,
        memo: String,
    ) -> Result<(), Error> {
        let token = query::fetch_token::fetch_token(token_id)?;

        let amount = Quantity::from_str(&amount, token.precision.into()).unwrap();

        let creditor = AccountNumber::from_str(&creditor.as_str()).unwrap();

        let packed_args = tokens::action_structs::debit {
            amount,
            creditor,
            memo,
            token_id: token.id,
        }
        .packed();

        add_action_to_transaction(tokens::action_structs::credit::ACTION_NAME, &packed_args)
    }

    fn uncredit(
        token_id: String,
        debitor: String,
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
            symbol_id: "".to_string(),
            precision: token.precision,
            current_supply: token.current_supply.to_string(),
            max_supply: token.max_supply.to_string(),
        })
    }
}

bindings::export!(TokensPlugin with_types_in bindings);
