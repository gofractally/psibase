#[allow(warnings)]
mod bindings;

use bindings::common::plugin::{server, types as CommonTypes};

use bindings::exports::component::tokens::{
    intf::Guest as Intf,
    transfer::{Guest as Transfer, Tid},
};

use bindings::exports::component::tokens::types::{Precision, Quantity};

use psibase::services::tokens as service;

use bindings::exports::component::tokens::types as Types;

struct Component;

use psibase::fracpack::Pack;

impl Intf for Component {
    fn create(precision: Precision, maxSupply: Quantity) -> Result<String, CommonTypes::Error> {
        let res = server::add_action_to_transaction(
            "create",
            &service::action_structs::create {
                precision: service::Precision { value: precision },
                maxSupply: service::Quantity { value: maxSupply },
            }
            .packed(),
        );
        Ok("whatever".to_string())
    }

    fn burn(tokenId: Tid, amount: Quantity) -> Result<String, CommonTypes::Error> {
        Ok("thanks".to_string())
    }

    fn mint(tokenId: Tid, amount: Quantity, memo: String) -> Result<String, CommonTypes::Error> {
        let res = server::add_action_to_transaction(
            "mint",
            &service::action_structs::mint {
                amount: service::Quantity { value: amount },
                memo,
                tokenId: tokenId,
            }
            .packed(),
        );
        Ok("mint ok".to_string())
    }
}

impl Transfer for Component {
    fn credit(token: Tid) -> Result<String, CommonTypes::Error> {
        Ok("whatever2".to_string())
    }
}

bindings::export!(Component with_types_in bindings);
