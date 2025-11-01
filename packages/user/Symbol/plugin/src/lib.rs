#[allow(warnings)]
mod bindings;

use bindings::exports::symbol::plugin::api::Guest as Api;
use bindings::host::types::types::Error;
use bindings::transact::plugin::intf::add_action_to_transaction;

use psibase::fracpack::Pack;
use psibase::{define_trust, AccountNumber};

mod errors;

define_trust! {
    descriptions {
        Low => "",
        Medium => "",
        High => "
        Creates new symbols and map them to tokens.
        ",
    }
    functions {
        High => [create, init, map_symbol],
    }
}

struct SymbolPlugin;

impl Api for SymbolPlugin {
    fn create(symbol: String) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::create)?;

        let packed_args = symbol::action_structs::create {
            symbol: AccountNumber::from(symbol.as_str()),
        }
        .packed();
        add_action_to_transaction(symbol::action_structs::create::ACTION_NAME, &packed_args)
    }

    fn init(token_id: u32) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::init)?;

        let packed_args = symbol::action_structs::init {
            billing_token: token_id,
        }
        .packed();
        add_action_to_transaction(symbol::action_structs::init::ACTION_NAME, &packed_args)
    }

    fn map_symbol(token_id: u32, symbol: String) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::map_symbol)?;

        let packed_args = symbol::action_structs::mapSymbol {
            token_id,
            symbol: AccountNumber::from(symbol.as_str()),
        }
        .packed();
        add_action_to_transaction(symbol::action_structs::mapSymbol::ACTION_NAME, &packed_args)
    }
}

bindings::export!(SymbolPlugin with_types_in bindings);
