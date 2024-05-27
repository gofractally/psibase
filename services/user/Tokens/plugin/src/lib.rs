#[allow(warnings)]
mod bindings;

use bindings::common::plugin::{server, types as CommonTypes};
use bindings::exports::component::tokens::types as Wit;
use bindings::exports::component::tokens::{intf::Guest as Intf, transfer::Guest as Transfer};
use psibase::services::tokens as Wrapper;
use psibase::AccountNumber;
use query::shared_balance::fetch_balances;
use query::token_detail::fetch_token;

mod errors;
use errors::ErrorType;
struct Component;

use psibase::fracpack::Pack;

mod query {
    pub mod shared_balance;
    pub mod token_detail;
}

enum TokenType {
    number(u32),
    symbol(String),
}

fn identify_token_type(token_id: String) -> Result<TokenType, CommonTypes::Error> {
    use TokenType::{number, symbol};

    let first_char = token_id
        .chars()
        .next()
        .ok_or(ErrorType::InvalidTokenId.err("token code is empty"))?;

    Ok(if first_char.is_ascii_digit() {
        number(
            token_id
                .parse::<u32>()
                .map_err(|_| ErrorType::InvalidTokenId.err("failed to parse token_id to u32"))?,
        )
    } else {
        symbol(token_id)
    })
}

fn token_code_to_id(token_id: Wit::TokenId) -> Result<u32, CommonTypes::Error> {
    let parsed = identify_token_type(token_id)?;
    match parsed {
        TokenType::number(number) => Ok(number),
        TokenType::symbol(_) => {
            unimplemented!("Dunno how to lookup a token by symbol")
        }
    }
}

impl Intf for Component {
    fn create(
        precision: Wit::Precision,
        maxSupply: Wit::Quantity,
    ) -> Result<(), CommonTypes::Error> {
        server::add_action_to_transaction(
            "create",
            &Wrapper::action_structs::create {
                precision: Wrapper::Precision::from(precision),
                maxSupply: Wrapper::Quantity::new(maxSupply.as_str(), precision),
            }
            .packed(),
        )
    }

    fn burn(
        code: Wit::TokenId,
        amount: Wit::Quantity,
        memo: String,
        account: Wit::AccountNumber,
    ) -> Result<(), CommonTypes::Error> {
        let token = fetch_token(token_code_to_id(code)?)?;

        if (account.len() as u8) == 0 {
            server::add_action_to_transaction(
                "burn",
                &Wrapper::action_structs::burn {
                    tokenId: token.id,
                    amount: Wrapper::Quantity::new(amount.as_str(), token.precision),
                }
                .packed(),
            )
        } else {
            server::add_action_to_transaction(
                "recall",
                &Wrapper::action_structs::recall {
                    tokenId: token.id,
                    amount: Wrapper::Quantity::new(amount.as_str(), token.precision),
                    from: AccountNumber::from(account.as_str()),
                    memo,
                }
                .packed(),
            )
        }
    }

    fn mint(
        code: Wit::TokenId,
        amount: Wit::Quantity,
        memo: String,
    ) -> Result<(), CommonTypes::Error> {
        let token = fetch_token(token_code_to_id(code)?)?;

        server::add_action_to_transaction(
            "mint",
            &Wrapper::action_structs::mint {
                amount: Wrapper::Quantity::new(amount.as_str(), token.precision),
                memo,
                tokenId: token.id,
            }
            .packed(),
        )
    }
}

impl Transfer for Component {
    fn token_owner(code: Wit::TokenId) -> Result<Wit::TokenDetail, CommonTypes::Error> {
        let token_id = token_code_to_id(code)?;
        let res = fetch_token(token_id)?;

        Ok(Wit::TokenDetail {
            id: res.id,
            owner: res.owner,
            precision: res.precision,
            symbol_id: res.symbol_id,
        })
    }

    fn balances() -> Result<Vec<Wit::Balance>, CommonTypes::Error> {
        Ok(fetch_balances()
            .unwrap()
            .into_iter()
            .map(|balance| Wit::Balance {
                balance: balance.balance,
                creditor: balance.key.creditor,
                debitor: balance.key.debitor,
                token_number: balance.key.tokenId,
            })
            .collect())
    }

    fn uncredit(
        code: Wit::TokenId,
        debitor: Wit::AccountNumber,
        amount: Wit::Quantity,
        memo: String,
    ) -> Result<(), CommonTypes::Error> {
        let fetched_token = fetch_token(token_code_to_id(code)?)?;
        let quantity = Wrapper::Quantity::new(amount.as_str(), fetched_token.precision);

        server::add_action_to_transaction(
            "uncredit",
            &Wrapper::action_structs::uncredit {
                tokenId: fetched_token.id,
                memo,
                maxAmount: quantity,
                receiver: AccountNumber::from(debitor.as_str()),
            }
            .packed(),
        )
        .expect("failed to add action to tx");

        Ok(())
    }

    fn credit(
        code: Wit::TokenId,
        receiver: Wit::AccountNumber,
        amount: Wit::Quantity,
        memo: String,
    ) -> Result<(), CommonTypes::Error> {
        let fetched_token = fetch_token(token_code_to_id(code)?)?;

        server::add_action_to_transaction(
            "credit",
            &Wrapper::action_structs::credit {
                amount: Wrapper::Quantity::new(amount.as_str(), fetched_token.precision),
                receiver: AccountNumber::from(receiver.as_str()),
                tokenId: fetched_token.id,
                memo,
            }
            .packed(),
        )
    }
}

bindings::export!(Component with_types_in bindings);