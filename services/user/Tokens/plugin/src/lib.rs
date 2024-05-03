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
    fn create(precision: Precision, maxSupply: Quantity) -> String {
        let res = server::add_action_to_transaction(
            "create",
            &service::action_structs::create {
                precision: service::Precision { value: precision },
                maxSupply: service::Quantity { value: maxSupply },
            }
            .packed(),
        );
        "whatever".to_string()
    }
}

impl Transfer for Component {
    fn credit(token: Tid) -> String {
        "whatever2".to_string()
    }
}

bindings::export!(Component with_types_in bindings);
