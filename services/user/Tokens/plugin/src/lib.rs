#[allow(warnings)]
mod bindings;

use bindings::common::plugin::{client, server, types as CommonTypes};
use bindings::exports::component::tokens::types as Wit;
use bindings::exports::component::tokens::{intf::Guest as Intf, transfer::Guest as Transfer};
use psibase::services::tokens as Wrapper;
use psibase::AccountNumber;
use query::shared_balance::fetch_balances;
use serde::{Deserialize, Serialize};

mod errors;

struct Component;

use psibase::fracpack::Pack;

mod query {
    pub mod shared_balance;
    pub mod token;
}

use query::token::{fetch_precision, Node, ResponseRoot, Token};

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
        tokenId: Wit::Tid,
        amount: Wit::Quantity,
        memo: String,
        account: Wit::AccountNumber,
    ) -> Result<(), CommonTypes::Error> {
        let pretend_looked_up_precision: u8 = 4;

        if (account.len() as u8) == 0 {
            server::add_action_to_transaction(
                "burn",
                &Wrapper::action_structs::burn {
                    tokenId,
                    amount: Wrapper::Quantity::new(amount.as_str(), pretend_looked_up_precision),
                }
                .packed(),
            )
        } else {
            server::add_action_to_transaction(
                "recall",
                &Wrapper::action_structs::recall {
                    tokenId,
                    amount: Wrapper::Quantity::new(amount.as_str(), pretend_looked_up_precision),
                    from: AccountNumber::from(account.as_str()),
                    memo,
                }
                .packed(),
            )
        }
    }

    fn mint(
        tokenId: Wit::Tid,
        amount: Wit::Quantity,
        memo: String,
    ) -> Result<(), CommonTypes::Error> {
        let pretend_looked_up_precision: u8 = 4;
        server::add_action_to_transaction(
            "mint",
            &Wrapper::action_structs::mint {
                amount: Wrapper::Quantity::new(amount.as_str(), pretend_looked_up_precision),
                memo,
                tokenId,
            }
            .packed(),
        )
    }
}

impl Transfer for Component {
    fn balances() -> Result<Vec<Wit::Balance>, CommonTypes::Error> {
        Ok(fetch_balances()
            .unwrap()
            .into_iter()
            .map(|balance| Wit::Balance {
                balance: balance.balance,
                creditor: balance.key.creditor,
                debitor: balance.key.debitor,
                token_id: balance.key.tokenId,
            })
            .collect())
    }

    fn uncredit(
        token: Wit::Tid,
        debitor: Wit::AccountNumber,
        amount: Wit::Quantity,
        memo: String,
    ) -> Result<(), CommonTypes::Error> {
        let precision = fetch_precision(token).expect("failed to fetch precision");
        let quantity = Wrapper::Quantity::new(amount.as_str(), precision);
        server::add_action_to_transaction(
            "uncredit",
            &Wrapper::action_structs::uncredit {
                tokenId: token,
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
        token: Wit::Tid,
        receiver: Wit::AccountNumber,
        amount: Wit::Quantity,
        memo: String,
    ) -> Result<(), CommonTypes::Error> {
        let precision = fetch_precision(token).expect("failed to fetch precision");

        server::add_action_to_transaction(
            "credit",
            &Wrapper::action_structs::credit {
                amount: Wrapper::Quantity::new(amount.as_str(), precision),
                receiver: AccountNumber::from(receiver.as_str()),
                tokenId: token,
                memo,
            }
            .packed(),
        )
    }
}

bindings::export!(Component with_types_in bindings);
