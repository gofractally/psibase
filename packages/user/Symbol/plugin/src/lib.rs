#[allow(warnings)]
mod bindings;

use bindings::exports::symbol::plugin::api::Guest as Api;
use bindings::host::types::types::Error;
use bindings::tokens::plugin::helpers::decimal_to_u64;
use bindings::transact::plugin::intf::add_action_to_transaction;

use psibase::fracpack::Pack;
use psibase::{define_trust, AccountNumber};

mod errors;

define_trust! {
    descriptions {
        Low => "",
        Medium => "",
        High => "
        Ability to purchase symbols
        ",
    }
    functions {
        High => [purchase, start_sale],
    }
}

struct SymbolPlugin;

impl Api for SymbolPlugin {
    fn purchase(symbol: String) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::purchase)?;
        let packed_example_thing_args = symbol::action_structs::purchase {
            symbol: AccountNumber::from(symbol.as_str()),
        }
        .packed();
        add_action_to_transaction(
            symbol::action_structs::purchase::ACTION_NAME,
            &packed_example_thing_args,
        )
        .unwrap();
        Ok(())
    }

    fn start_sale(
        len: u8,
        token_id: u32,
        initial_price: String,
        window_seconds: u32,
        target_min: u32,
        target_max: u32,
        floor_price: String,
        percent_change: u32,
    ) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::start_sale)?;

        let packed_args = symbol::action_structs::start_sale {
            len,
            floor_price: decimal_to_u64(token_id, &floor_price)?.into(),
            initial_price: decimal_to_u64(token_id, &initial_price)?.into(),
            percent_change,
            target_min,
            target_max,
            window_seconds,
        }
        .packed();
        add_action_to_transaction(
            symbol::action_structs::start_sale::ACTION_NAME,
            &packed_args,
        )
    }
}

bindings::export!(SymbolPlugin with_types_in bindings);
