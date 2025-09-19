#[allow(warnings)]
mod bindings;

use bindings::exports::difficulty::plugin::api::Guest as Api;
use bindings::host::types::types::Error;

use bindings::tokens::plugin::helpers::decimal_to_u64;

use psibase::define_trust;
use psibase::fracpack::Pack;

use crate::bindings::transact::plugin::intf::add_action_to_transaction;

define_trust! {
    descriptions {
        Low => "
        Creation of difficulty items
        ",
        Medium => "",
        High => "
        Incrementing difficulty items and deleting difficulty instances
        ",
    }
    functions {
        Low => [create],
        High => [increment, delete],
    }
}

struct DifficultyPlugin;

impl Api for DifficultyPlugin {
    fn create(
        token_id: u32,
        initial_price: String,
        floor_price: String,
        window_seconds: u32,
        percent_change: u8,
        target: u32,
    ) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::create)?;

        let packed_args = difficulty::action_structs::create {
            window_seconds,
            initial_price: decimal_to_u64(token_id, &initial_price)?.into(),
            floor_price: decimal_to_u64(token_id, &floor_price)?.into(),
            percent_change,
            target,
        }
        .packed();

        add_action_to_transaction(
            difficulty::action_structs::create::ACTION_NAME,
            &packed_args,
        )
    }

    fn increment(nft_id: u32) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::increment)?;

        let packed_args = difficulty::action_structs::increment { nft_id }.packed();

        add_action_to_transaction(
            difficulty::action_structs::increment::ACTION_NAME,
            &packed_args,
        )
    }

    fn delete(nft_id: u32) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::delete)?;

        let packed_args = difficulty::action_structs::delete { nft_id }.packed();

        add_action_to_transaction(
            difficulty::action_structs::delete::ACTION_NAME,
            &packed_args,
        )
    }
}

bindings::export!(DifficultyPlugin with_types_in bindings);
