#[allow(warnings)]
mod bindings;

use bindings::wasi::random::random::get_random_u64;

use bindings::common::plugin::{server, types as CommonTypes};
use bindings::exports::component::tokens::types as Wit;
use bindings::exports::component::tokens::{intf::Guest as Intf, transfer::Guest as Transfer};
use psibase::services::tokens as Wrapper;

struct Component;

use psibase::fracpack::Pack;

mod convert;

impl Intf for Component {
    fn create(
        precision: Wit::Precision,
        maxSupply: Wit::Quantity,
    ) -> Result<String, CommonTypes::Error> {
        // convert::convert_to_u64("number", 4, true);

        let _ = server::add_action_to_transaction(
            "create",
            &Wrapper::action_structs::create {
                precision: Wrapper::Precision::from(precision),
                maxSupply: Wrapper::Quantity::new(maxSupply.as_str(), precision),
            }
            .packed(),
        );
        Ok("whatever".to_string())
    }

    fn burn(tokenId: Wit::Tid, amount: Wit::Quantity) -> Result<String, CommonTypes::Error> {
        Ok("thanks".to_string())
    }

    fn mint(
        tokenId: Wit::Tid,
        amount: Wit::Quantity,
        memo: String,
    ) -> Result<String, CommonTypes::Error> {
        let pretend_looked_up_precision: u8 = 4;
        let _ = server::add_action_to_transaction(
            "mint",
            &Wrapper::action_structs::mint {
                amount: Wrapper::Quantity::new(amount.as_str(), pretend_looked_up_precision),
                memo,
                tokenId,
            }
            .packed(),
        );
        Ok("mint ok".to_string())
    }
}

impl Transfer for Component {
    fn credit(token: Wit::Tid) -> Result<String, CommonTypes::Error> {
        Ok("whatever2".to_string())
    }
}

bindings::export!(Component with_types_in bindings);
