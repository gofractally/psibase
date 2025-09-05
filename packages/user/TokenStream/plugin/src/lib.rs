#[allow(warnings)]
mod bindings;

use bindings::exports::token_stream::plugin::api::Guest as Api;
use bindings::host::types::types::Error;
use bindings::transact::plugin::intf::add_action_to_transaction;

use psibase::define_trust;
use psibase::fracpack::Pack;

mod errors;

define_trust! {
    descriptions {
        Low => "",
        Medium => "Create a token stream",
        High => "Deposit tokens, claim and delete a stream",
    }
    functions {
        Low => [],
        Medium => [create],
        High => [deposit, claim, delete],
    }
}

struct TokenStreamPlugin;

fn decay_rate_from_half_life(seconds: f64) -> u32 {
    let rate = std::f64::consts::LN_2 / seconds;

    (rate * 1_000_000.0).round() as u32
}

impl Api for TokenStreamPlugin {
    fn create(half_life_seconds: u64, token_id: u32) -> Result<(), Error> {
        trust::authorize(trust::FunctionName::create)?;

        let decay_rate_per_million = decay_rate_from_half_life(half_life_seconds as f64);
        let packed_args = token_stream::action_structs::create {
            decay_rate_per_million,
            token_id,
        }
        .packed();
        add_action_to_transaction(
            token_stream::action_structs::create::ACTION_NAME,
            &packed_args,
        )
    }

    fn deposit(nft_id: u32, token_id: String, amount: String, memo: String) -> Result<(), Error> {
        trust::authorize(trust::FunctionName::deposit)?;

        let _ = bindings::tokens::plugin::transfer::credit(
            &token_id,
            &"token-stream".to_string(),
            &amount,
            &memo,
        );

        let packed_args = token_stream::action_structs::deposit { nft_id }.packed();

        add_action_to_transaction(
            token_stream::action_structs::deposit::ACTION_NAME,
            &packed_args,
        )
    }

    fn claim(nft_id: u32) -> Result<(), Error> {
        trust::authorize(trust::FunctionName::claim)?;

        let packed_args = token_stream::action_structs::claim { nft_id }.packed();

        add_action_to_transaction(
            token_stream::action_structs::claim::ACTION_NAME,
            &packed_args,
        )
    }

    fn delete(nft_id: u32) -> Result<(), Error> {
        trust::authorize(trust::FunctionName::delete)?;

        let packed_args = token_stream::action_structs::delete { nft_id }.packed();

        add_action_to_transaction(
            token_stream::action_structs::delete::ACTION_NAME,
            &packed_args,
        )
    }
}

bindings::export!(TokenStreamPlugin with_types_in bindings);
