#[allow(warnings)]
mod bindings;

mod find_path;
use bindings::exports::token_swap::plugin::api::Guest as Api;
use bindings::exports::token_swap::plugin::queries::Guest as Queries;
use bindings::host::common::server as CommonServer;
use bindings::host::types::types::Error;
use bindings::transact::plugin::intf::add_action_to_transaction;

use bindings::tokens::plugin::helpers::decimal_to_u64;
use psibase::fracpack::Pack;
use psibase::{define_trust, services::token_swap::action_structs::swap};

mod graphql;

mod errors;
use errors::ErrorType;
use psibase::services::tokens::{Quantity, TID};

define_trust! {
    descriptions {
        Low => "
        Low trust grants these abilities:
            - Reading the value of the example-thing
        ",
        Medium => "",
        High => "
        High trust grants the abilities of all lower trust levels, plus these abilities:
            - Setting the example thing
        ",
    }
    functions {
        Low => [get_example_thing],
        High => [],
    }
}

struct TokenSwapPlugin;

impl Api for TokenSwapPlugin {
    fn get_amount(
        from_token: u32,
        amount: String,
        to_token: u32,
        max_hops: u8,
    ) -> Result<String, Error> {
        Ok("f".to_string())
    }

    fn add_liquidity(
        pool_id: u32,
        token_a: TID,
        token_b: TID,
        amount_a_desired: String,
        amount_b_desired: String,
        amount_a_min: String,
        amount_b_min: String,
    ) -> Result<(), Error> {
        let token_a_amount_desired: Quantity = decimal_to_u64(token_a, &amount_a_desired)?.into();
        let token_b_amount_desired: Quantity = decimal_to_u64(token_b, &amount_b_desired)?.into();
        let token_a_amount_min: Quantity = decimal_to_u64(token_a, &amount_a_min)?.into();
        let token_b_amount_min: Quantity = decimal_to_u64(token_b, &amount_b_min)?.into();

        bindings::tokens::plugin::user::credit(
            token_a,
            &token_swap::SERVICE.to_string(),
            &amount_a_desired,
            "".try_into().unwrap(),
        )?;

        bindings::tokens::plugin::user::credit(
            token_b,
            &token_swap::SERVICE.to_string(),
            &amount_b_desired,
            "".try_into().unwrap(),
        )?;

        let packed_args = token_swap::action_structs::add_liquidity {
            pool_id,
            amount_a_desired: token_a_amount_desired,
            amount_b_desired: token_b_amount_desired,
            amount_a_min: token_a_amount_min,
            amount_b_min: token_b_amount_min,
        }
        .packed();

        add_action_to_transaction(
            token_swap::action_structs::add_liquidity::ACTION_NAME,
            &packed_args,
        )
    }

    fn swap(
        pools: Vec<String>,
        token_in: TID,
        amount_in: String,
        min_return: String,
    ) -> Result<(), Error> {
        let in_amount: Quantity = decimal_to_u64(token_in, &amount_in)?.into();
        let min_return: Quantity = decimal_to_u64(token_in, &min_return)?.into();

        bindings::tokens::plugin::user::credit(
            token_in,
            token_swap::SERVICE.to_string().as_str(),
            &amount_in,
            "swap".try_into().unwrap(),
        )?;

        let packed_args = token_swap::action_structs::swap {
            amount_in: in_amount,
            min_return,
            pools: pools
                .into_iter()
                .map(|pool_id| pool_id.parse::<u32>().unwrap())
                .collect(),
            token_in,
        }
        .packed();

        add_action_to_transaction(token_swap::action_structs::swap::ACTION_NAME, &packed_args)
    }

    fn new_pool(
        token_a: TID,
        token_b: TID,
        amount_a: String,
        amount_b: String,
    ) -> Result<(), Error> {
        let token_a_amount: Quantity = decimal_to_u64(token_a, &amount_a)?.into();
        let token_b_amount: Quantity = decimal_to_u64(token_b, &amount_b)?.into();

        bindings::tokens::plugin::user::credit(
            token_a,
            "token-swap",
            &amount_a,
            "".try_into().unwrap(),
        )?;

        bindings::tokens::plugin::user::credit(
            token_b,
            "token-swap",
            &amount_b,
            "".try_into().unwrap(),
        )?;

        let packed_args = token_swap::action_structs::new_pool {
            token_a,
            token_b,
            token_a_amount,
            token_b_amount,
        }
        .packed();

        add_action_to_transaction(
            token_swap::action_structs::new_pool::ACTION_NAME,
            &packed_args,
        )
    }
}

#[derive(serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct ExampleThingData {
    example_thing: String,
}
#[derive(serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct ExampleThingResponse {
    data: ExampleThingData,
}

impl Queries for TokenSwapPlugin {
    fn get_example_thing() -> Result<String, Error> {
        trust::assert_authorized(trust::FunctionName::get_example_thing)?;

        let graphql_str = "query { exampleThing }";

        let examplething_val = serde_json::from_str::<ExampleThingResponse>(
            &CommonServer::post_graphql_get_json(&graphql_str)?,
        );

        let examplething_val =
            examplething_val.map_err(|err| ErrorType::QueryResponseParseError(err.to_string()))?;

        Ok(examplething_val.data.example_thing)
    }
}

bindings::export!(TokenSwapPlugin with_types_in bindings);
