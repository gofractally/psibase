#[allow(warnings)]
mod bindings;

use bindings::exports::prem_accounts::plugin::api::Guest as Api;
use bindings::exports::prem_accounts::plugin::queries::Guest as Queries;
use bindings::host::common::server as CommonServer;
use bindings::host::types::types::Error;
use bindings::tokens::plugin::helpers as TokensHelpers;
use bindings::tokens::plugin::user as TokensUser;
use bindings::transact::plugin::intf::add_action_to_transaction;

use psibase::define_trust;
use psibase::fracpack::Pack;
use psibase::services::tokens::{Precision, Quantity};

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
    fn buy(account: String, max_cost: String) -> Result<(), Error> {
        println!("buy().top w account: {}, max_cost: {}", account, max_cost);
        trust::assert_authorized(trust::FunctionName::buy)?;

        let service_account = "prem-accounts";

        println!("1");
        let sys_token_id = TokensHelpers::fetch_network_token()?.unwrap();

        println!("2: crediting {} {} tokens", service_account, max_cost);
        TokensUser::credit(
            sys_token_id,
            service_account,
            &max_cost,
            "premium account purchase",
        )?;

        println!("3");
        let packed_buy_args = prem_accounts::action_structs::buy {
            account,
            max_cost: Quantity::from_str(&max_cost, Precision::new(4).unwrap())
                .unwrap()
                .value,
        }
        .packed();
        println!("buy() packed_buy_args: {:?}", packed_buy_args);
        add_action_to_transaction("buy", &packed_buy_args).unwrap();
        println!("buy() add_action_to_transaction returned");
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
