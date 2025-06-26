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
use psibase::{AccountNumber, Quantity};

pub mod query {
    pub mod fetch_token;
}

struct TokensPlugin;

enum TokenType {
    Number(u32),
    Symbol(AccountNumber),
}

fn identify_token_type(token_id: String) -> Result<TokenType, Error> {
    use TokenType::{Number, Symbol};

    let first_char = token_id
        .chars()
        .next()
        .ok_or(ErrorType::InvalidTokenId("token id is empty".to_string()))?;

    Ok(if first_char.is_ascii_digit() {
        Number(token_id.parse::<u32>().map_err(|_| {
            ErrorType::InvalidTokenId("failed to parse token_id to u32".to_string())
        })?)
    } else {
        Symbol(AccountNumber::from_str(token_id.as_str()).unwrap())
    })
}

fn token_id_to_number(token_id: Wit::TokenId) -> Result<u32, Error> {
    match identify_token_type(token_id)? {
        TokenType::Number(number) => Ok(number),
        TokenType::Symbol(_str) => Ok(1),
    }
}

impl Intf for TokensPlugin {
    fn create(precision: u8, max_supply: Wit::Quantity) -> Result<(), Error> {
        let max_supply = Quantity::from_str(&max_supply, precision.into()).unwrap();

        let packed_args = tokens::action_structs::create {
            max_supply,
            precision,
        }
        .packed();

        add_action_to_transaction(tokens::action_structs::create::ACTION_NAME, &packed_args)
    }

    fn burn(token_id: Wit::TokenId, amount: Wit::Quantity, memo: String) -> Result<(), Error> {
        let token_id = token_id_to_number(token_id)?;

        let token = query::fetch_token::fetch_token(token_id)?;

        let amount = Quantity::from_str(&amount, token.precision.into()).unwrap();

        let packed_args = tokens::action_structs::burn {
            amount,
            memo,
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
        let from = AccountNumber::from_str(from.as_str()).unwrap();

        let amount = Quantity::from_str(&amount, token.precision.into()).unwrap();

        let packed_args = tokens::action_structs::recall {
            amount,
            from,
            memo,
            token_id: token.id,
        }
        .packed();
        add_action_to_transaction(tokens::action_structs::recall::ACTION_NAME, &packed_args)
    }

    fn map_symbol(token_id: Wit::TokenId, symbol: Wit::AccountNumber) -> Result<(), Error> {
        let token_id = token_id_to_number(token_id)?;

        let packed_args = tokens::action_structs::map_symbol {
            token_id,
            symbol: AccountNumber::from_str(symbol.as_str()).unwrap(),
        }
        .packed();
        add_action_to_transaction(
            tokens::action_structs::map_symbol::ACTION_NAME,
            &packed_args,
        )
    }

    fn mint(token_id: Wit::TokenId, amount: Wit::Quantity, memo: String) -> Result<(), Error> {
        let token_id = token_id_to_number(token_id)?;

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

    fn set_user_global_config(index: u8, enabled: bool) -> Result<(), Error> {
        let packed_args =
            tokens::action_structs::set_user_global_config { enabled, index }.packed();
        add_action_to_transaction(
            tokens::action_structs::set_user_global_config::ACTION_NAME,
            &packed_args,
        )
    }

    fn set_user_token_config(
        token_id: Wit::TokenId,
        index: u8,
        enabled: bool,
    ) -> Result<(), Error> {
        let token_id = token_id_to_number(token_id)?;

        let packed_args = tokens::action_structs::set_user_token_config {
            enabled,
            index,
            token_id,
        }
        .packed();
        add_action_to_transaction(
            tokens::action_structs::set_user_token_config::ACTION_NAME,
            &packed_args,
        )
    }

    fn set_token_config(token_id: Wit::TokenId, index: u8, enabled: bool) -> Result<(), Error> {
        let token_id = token_id_to_number(token_id)?;

        let packed_args = tokens::action_structs::set_token_config {
            enabled,
            index,
            token_id,
        }
        .packed();
        add_action_to_transaction(
            tokens::action_structs::set_token_config::ACTION_NAME,
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
        token_id: Wit::TokenId,
        creditor: Wit::AccountNumber,
        amount: Wit::Quantity,
        memo: String,
    ) -> Result<(), Error> {
        let token_id = token_id_to_number(token_id)?;

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

        add_action_to_transaction(tokens::action_structs::debit::ACTION_NAME, &packed_args)
    }

    fn uncredit(
        token_id: Wit::TokenId,
        debitor: Wit::AccountNumber,
        amount: Wit::Quantity,
        memo: String,
    ) -> Result<(), Error> {
        let token_id = token_id_to_number(token_id)?;
        let token = query::fetch_token::fetch_token(token_id)?;

        let amount = Quantity::from_str(&amount, token.precision.into()).unwrap();

        let debitor = AccountNumber::from_str(debitor.as_str()).unwrap();

        let packed_args = tokens::action_structs::uncredit {
            amount,
            memo,
            debitor,
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
            precision: token.precision,
            current_supply: token.current_supply.to_string(),
            max_supply: token.max_supply.to_string(),
        })
    }
}

bindings::export!(TokensPlugin with_types_in bindings);
