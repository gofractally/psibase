#[allow(warnings)]
mod bindings;

use bindings::wasi::random::random::get_random_u64;

use bindings::common::plugin::{server, types as CommonTypes};
use bindings::exports::component::tokens::types as Wit;
use bindings::exports::component::tokens::{intf::Guest as Intf, transfer::Guest as Transfer};
use psibase::services::tokens as Wrapper;
use psibase::AccountNumber;

struct Component;

use psibase::fracpack::Pack;

mod convert;

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
    fn credit(
        token: Wit::Tid,
        receiver: Wit::AccountNumber,
        amount: Wit::Quantity,
        memo: String,
    ) -> Result<(), CommonTypes::Error> {
        let pretend_looked_up_precision: u8 = 4;
        let amount = Wrapper::Quantity::new(amount.as_str(), pretend_looked_up_precision);
        server::add_action_to_transaction(
            "credit",
            &Wrapper::action_structs::credit {
                amount,
                memo,
                receiver: AccountNumber::from(receiver.as_str()),
                tokenId: token,
            }
            .packed(),
        )
    }
}

bindings::export!(Component with_types_in bindings);
