#[allow(warnings)]
mod bindings;

use bindings::exports::prem_accounts::plugin::api::Guest as Api;
use bindings::exports::prem_accounts::plugin::queries::Guest as Queries;
use bindings::host::common::server as CommonServer;
use bindings::host::types::types::Error;
use bindings::transact::plugin::intf::add_action_to_transaction;

use psibase::define_trust;
use psibase::fracpack::Pack;

mod errors;
use errors::ErrorType;
use psibase::services::invite::SubjectPublicKeyInfo;

define_trust! {
    descriptions {
        Low => "
        Low trust grants these abilities:
            - Querying account prices
        ",
        Medium => "
        Medium trust grants the abilities of the Low trust level, plus these abilities:
            - Purchasing premium account names
            - Claiming premium account names
        ",
        High => "",
    }
    functions {
        Low => [get_prices],
        High => [buy, claim],
    }
}

struct PremAccountsPlugin;

impl Api for PremAccountsPlugin {
    fn buy(account: String, max_cost: u64) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::buy)?;
        let packed_buy_args = prem_accounts::action_structs::buy { account, max_cost }.packed();
        add_action_to_transaction("buy", &packed_buy_args).unwrap();
        Ok(())
    }

    fn claim(account: String, pub_key: String) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::claim)?;
        let packed_claim_args = prem_accounts::action_structs::claim {
            account,
            pub_key: SubjectPublicKeyInfo::from(pub_key.as_bytes().to_vec()),
        }
        .packed();
        add_action_to_transaction("claim", &packed_claim_args).unwrap();
        Ok(())
    }
}

#[derive(serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct GetPricesResponse {
    data: GetPricesData,
}

#[derive(serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct GetPricesData {
    get_prices: Vec<u64>,
}

impl Queries for PremAccountsPlugin {
    // TODO: Should this query also be an action for srv-to-srv calls?
    fn get_prices() -> Result<Vec<u64>, Error> {
        let graphql_str = "query { getPrices }";

        let response = serde_json::from_str::<GetPricesResponse>(
            &CommonServer::post_graphql_get_json(&graphql_str)?,
        );

        let response =
            response.map_err(|err| ErrorType::QueryResponseParseError(err.to_string()))?;

        Ok(response.data.get_prices)
    }
}

bindings::export!(PremAccountsPlugin with_types_in bindings);
