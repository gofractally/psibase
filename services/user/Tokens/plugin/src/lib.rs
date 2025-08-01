#[allow(warnings)]
mod bindings;

use std::str::FromStr;

use bindings::exports::tokens::plugin::intf::Guest as Intf;
use bindings::exports::tokens::plugin::queries::Guest as Queries;
use bindings::exports::tokens::plugin::transfer::Guest as Transfer;
use bindings::exports::tokens::plugin::types as Wit;

use bindings::host::common::types::Error;
use bindings::transact::plugin::intf::add_action_to_transaction;

use psibase::fracpack::Pack;

mod errors;
use errors::ErrorType;
use psibase::services::tokens::quantity::Quantity;
use psibase::AccountNumber;
use tokens::helpers::{identify_token_type, TokenType};

pub mod query {
    pub mod fetch_token;
}

struct TokensPlugin;

fn token_id_to_number(token_id: Wit::TokenId) -> Result<u32, Error> {
    match identify_token_type(token_id) {
        TokenType::Number(number) => Ok(number),
        TokenType::Symbol(_str) => {
            Err(ErrorType::NotImplemented("Symbol to token number not ready".into()).into())
        }
    }
}

impl Intf for TokensPlugin {
    fn create(precision: u8, max_issued_supply: Wit::Quantity) -> Result<(), Error> {
        let max_issued_supply =
            Quantity::from_str(&max_issued_supply, precision.try_into().unwrap()).unwrap();

        let packed_args = tokens::action_structs::create {
            max_issued_supply,
            precision: precision.try_into().unwrap(),
        }
        .packed();

        add_action_to_transaction(tokens::action_structs::create::ACTION_NAME, &packed_args)
    }

    fn burn(token_id: Wit::TokenId, amount: Wit::Quantity, memo: String) -> Result<(), Error> {
        let token_id = token_id_to_number(token_id)?;

        let token = query::fetch_token::fetch_token(token_id)?;

        let amount = Quantity::from_str(&amount, token.precision).unwrap();

        let packed_args = tokens::action_structs::burn {
            amount,
            memo: memo.try_into().unwrap(),
            token_id: token.id,
        }
        .packed();
        add_action_to_transaction(tokens::action_structs::burn::ACTION_NAME, &packed_args)
    }

    fn recall(
        token_id: Wit::TokenId,
        amount: Wit::Quantity,
        memo: String,
        from: Wit::AccountNumber,
    ) -> Result<(), Error> {
        let token_id = token_id_to_number(token_id)?;

        let token = query::fetch_token::fetch_token(token_id)?;

        let amount = Quantity::from_str(&amount, token.precision).unwrap();

        let packed_args = tokens::action_structs::recall {
            amount,
            from: from.as_str().into(),
            memo: memo.try_into().unwrap(),
            token_id: token.id,
        }
        .packed();
        add_action_to_transaction(tokens::action_structs::recall::ACTION_NAME, &packed_args)
    }

    fn map_symbol(token_id: Wit::TokenId, symbol: Wit::AccountNumber) -> Result<(), Error> {
        let token_id = token_id_to_number(token_id)?;

        let packed_args = tokens::action_structs::mapSymbol {
            token_id,
            symbol: AccountNumber::from_str(symbol.as_str()).unwrap(),
        }
        .packed();
        add_action_to_transaction(tokens::action_structs::mapSymbol::ACTION_NAME, &packed_args)
    }

    fn mint(token_id: Wit::TokenId, amount: Wit::Quantity, memo: String) -> Result<(), Error> {
        let token_id = token_id_to_number(token_id)?;

        let token = query::fetch_token::fetch_token(token_id)?;

        let amount = Quantity::from_str(&amount, token.precision).unwrap();

        let packed_args = tokens::action_structs::mint {
            amount,
            memo: memo.try_into().unwrap(),
            token_id: token.id,
        }
        .packed();
        add_action_to_transaction(tokens::action_structs::mint::ACTION_NAME, &packed_args)
    }

    fn set_balance_config(token_id: Wit::TokenId, index: u8, enabled: bool) -> Result<(), Error> {
        let token_id = token_id_to_number(token_id)?;

        let packed_args = tokens::action_structs::setBalConf {
            enabled,
            index,
            token_id,
        }
        .packed();
        add_action_to_transaction(
            tokens::action_structs::setBalConf::ACTION_NAME,
            &packed_args,
        )
    }

    fn del_balance_config(token_id: Wit::TokenId) -> Result<(), Error> {
        let token_id = token_id_to_number(token_id)?;

        let packed_args = tokens::action_structs::delBalConf { token_id }.packed();

        add_action_to_transaction(
            tokens::action_structs::delBalConf::ACTION_NAME,
            &packed_args,
        )
    }

    fn set_token_config(token_id: Wit::TokenId, index: u8, enabled: bool) -> Result<(), Error> {
        let token_id = token_id_to_number(token_id)?;

        let packed_args = tokens::action_structs::setTokenConf {
            enabled,
            index,
            token_id,
        }
        .packed();
        add_action_to_transaction(
            tokens::action_structs::setTokenConf::ACTION_NAME,
            &packed_args,
        )
    }

    fn set_user_config(index: u8, enabled: bool) -> Result<(), Error> {
        let packed_args = tokens::action_structs::setUserConf { enabled, index }.packed();
        add_action_to_transaction(
            tokens::action_structs::setUserConf::ACTION_NAME,
            &packed_args,
        )
    }
}

impl Transfer for TokensPlugin {
    fn credit(
        token_id: Wit::TokenId,
        debitor: Wit::AccountNumber,
        amount: Wit::Quantity,
        memo: String,
    ) -> Result<(), Error> {
        let token_id = token_id_to_number(token_id)?;

        let token = query::fetch_token::fetch_token(token_id)?;

        let amount = Quantity::from_str(&amount, token.precision).unwrap();

        let packed_args = tokens::action_structs::credit {
            amount,
            memo: memo.try_into().unwrap(),
            debitor: debitor.as_str().into(),
            token_id: token.id,
        }
        .packed();

        add_action_to_transaction(tokens::action_structs::credit::ACTION_NAME, &packed_args)
    }

    fn debit(
        token_id: Wit::TokenId,
        creditor: Wit::AccountNumber,
        amount: Wit::Quantity,
        memo: String,
    ) -> Result<(), Error> {
        let token_id = token_id_to_number(token_id)?;

        let token = query::fetch_token::fetch_token(token_id)?;

        let amount = Quantity::from_str(&amount, token.precision).unwrap();

        let packed_args = tokens::action_structs::debit {
            amount,
            creditor: creditor.as_str().into(),
            memo: memo.try_into().unwrap(),
            token_id: token.id,
        }
        .packed();

        add_action_to_transaction(tokens::action_structs::debit::ACTION_NAME, &packed_args)
    }

    fn reject(
        token_id: Wit::TokenId,
        creditor: Wit::AccountNumber,
        memo: String,
    ) -> Result<(), Error> {
        let token_id = token_id_to_number(token_id)?;

        let token = query::fetch_token::fetch_token(token_id)?;

        let packed_args = tokens::action_structs::reject {
            creditor: creditor.as_str().into(),
            token_id: token.id,
            memo: memo.try_into().unwrap(),
        }
        .packed();

        add_action_to_transaction(tokens::action_structs::reject::ACTION_NAME, &packed_args)
    }

    fn uncredit(
        token_id: Wit::TokenId,
        debitor: Wit::AccountNumber,
        amount: Wit::Quantity,
        memo: String,
    ) -> Result<(), Error> {
        let token_id = token_id_to_number(token_id)?;
        let token = query::fetch_token::fetch_token(token_id)?;

        let amount = Quantity::from_str(&amount, token.precision).unwrap();

        let packed_args = tokens::action_structs::uncredit {
            amount,
            memo: memo.try_into().unwrap(),
            debitor: debitor.as_str().into(),
            token_id: token.id,
        }
        .packed();

        add_action_to_transaction(tokens::action_structs::uncredit::ACTION_NAME, &packed_args)
    }
}

impl Queries for TokensPlugin {
    fn token_owner(token_id: Wit::TokenId) -> Result<Wit::TokenDetail, Error> {
        let token_id = token_id_to_number(token_id)?;
        let token = query::fetch_token::fetch_token(token_id)?;

        Ok(Wit::TokenDetail {
            id: token.id,
            owner: token.owner.to_string(),
            symbol_id: token
                .symbol
                .map(|symbol| symbol.to_string())
                .unwrap_or("".to_string()),
            precision: token.precision.value(),
            current_supply: token.current_supply.to_string(),
            max_issued_supply: token.max_issued_supply.to_string(),
        })
    }
}

bindings::export!(TokensPlugin with_types_in bindings);
