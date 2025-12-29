#[allow(warnings)]
mod bindings;

use bindings::exports::credit_lines::plugin::api::Guest as Api;
use bindings::exports::credit_lines::plugin::queries::Guest as Queries;
use bindings::host::common::server as CommonServer;
use bindings::host::types::types::Error;
use bindings::transact::plugin::intf::add_action_to_transaction;

use psibase::fracpack::Pack;
use psibase::{define_trust, Memo};

mod errors;
use errors::ErrorType;

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
        High => [set_example_thing],
    }
}

struct CreditLinesPlugin;

impl Api for CreditLinesPlugin {
    fn accept_pending_credit(
        id: u32,
    ) -> Result<(), bindings::exports::credit_lines::plugin::api::Error> {
        let packed_args = credit_lines::action_structs::accept_pen { proposal_id: id }.packed();
        add_action_to_transaction(
            credit_lines::action_structs::accept_pen::ACTION_NAME,
            &packed_args,
        )
    }

    fn cancel_pending_credit(id: u32) -> Result<(), Error> {
        let packed_args = credit_lines::action_structs::cancel_pen { proposal_id: id }.packed();
        add_action_to_transaction(
            credit_lines::action_structs::cancel_pen::ACTION_NAME,
            &packed_args,
        )
    }

    fn del_credit_line(ticker: String, counter_party: String) -> Result<(), Error> {
        let packed_args = credit_lines::action_structs::del_line {
            ticker: ticker.as_str().into(),
            counter_party: counter_party.as_str().into(),
        }
        .packed();
        add_action_to_transaction(
            credit_lines::action_structs::del_line::ACTION_NAME,
            &packed_args,
        )
    }

    fn accrue_interest(ticker: String, account_a: String, account_b: String) -> Result<(), Error> {
        let packed_args = credit_lines::action_structs::accrue {
            ticker: ticker.as_str().into(),
            account_a: account_a.as_str().into(),
            account_b: account_b.as_str().into(),
        }
        .packed();
        add_action_to_transaction(
            credit_lines::action_structs::accrue::ACTION_NAME,
            &packed_args,
        )
    }

    fn add_ticker(ticker: String, name: String, precision: u8) -> Result<(), Error> {
        let packed_args = credit_lines::action_structs::add_ticker {
            ticker: ticker.as_str().into(),
            label: Memo::try_from(name.as_str()).unwrap(),
            precision: precision.try_into().unwrap(),
        }
        .packed();
        add_action_to_transaction(
            credit_lines::action_structs::add_ticker::ACTION_NAME,
            &packed_args,
        )
    }

    fn set_grace_period(
        ticker: String,
        counter_party: String,
        grace_period_seconds: u32,
    ) -> Result<(), Error> {
        let packed_args = credit_lines::action_structs::set_grace {
            ticker: ticker.as_str().into(),
            counter_party: counter_party.as_str().into(),
            grace_period: grace_period_seconds,
        }
        .packed();
        add_action_to_transaction(
            credit_lines::action_structs::set_grace::ACTION_NAME,
            &packed_args,
        )
    }

    fn set_interest_rate(
        ticker: String,
        counter_party: String,
        interest_rate_ppm: u32,
    ) -> Result<(), Error> {
        let packed_args = credit_lines::action_structs::set_int_rate {
            ticker: ticker.as_str().into(),
            counter_party: counter_party.as_str().into(),
            rate_ppm: interest_rate_ppm,
        }
        .packed();
        add_action_to_transaction(
            credit_lines::action_structs::set_int_rate::ACTION_NAME,
            &packed_args,
        )
    }

    fn draw(
        ticker: String,
        creditors: Vec<String>,
        amount: i64,
        memo: String,
    ) -> Result<(), Error> {
        let packed_args = credit_lines::action_structs::draw {
            ticker: ticker.as_str().into(),
            creditors: creditors.into_iter().map(|c| c.as_str().into()).collect(),
            amount: amount.try_into().unwrap(),
            memo: memo.try_into().unwrap(),
        }
        .packed();
        add_action_to_transaction(
            credit_lines::action_structs::draw::ACTION_NAME,
            &packed_args,
        )
    }

    fn new_pending_credit(
        ticker: String,
        debitor: String,
        creditor: String,
        amount: i64,
        memo: String,
    ) -> Result<(), Error> {
        let packed_args = credit_lines::action_structs::new_pen_cred {
            ticker: ticker.as_str().into(),
            debitor: debitor.as_str().into(),
            creditor: creditor.as_str().into(),
            amount: amount.into(),
            memo: memo.try_into().unwrap(),
        }
        .packed();

        add_action_to_transaction(
            credit_lines::action_structs::new_pen_cred::ACTION_NAME,
            &packed_args,
        )
    }

    fn set_credit_limit(ticker: String, debitor: String, amount: i64) -> Result<(), Error> {
        let packed_args = credit_lines::action_structs::set_crd_lim {
            ticker: ticker.as_str().into(),
            counter_party: debitor.as_str().into(),
            max_credit: amount.into(),
        }
        .packed();

        add_action_to_transaction(
            credit_lines::action_structs::set_crd_lim::ACTION_NAME,
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

impl Queries for CreditLinesPlugin {
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

bindings::export!(CreditLinesPlugin with_types_in bindings);
