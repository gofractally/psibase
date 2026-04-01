#[allow(warnings)]
mod bindings;

use bindings::auth_sig::plugin::keyvault as AuthSigKeyVault;
use bindings::exports::prem_accounts::plugin::admin::Guest as Admin;
use bindings::exports::prem_accounts::plugin::api::Guest as Api;
use bindings::exports::prem_accounts::plugin::queries::Guest as Queries;
use bindings::exports::prem_accounts::plugin::queries::MarketPrice;
use bindings::host::common::client as HostClient;
use bindings::host::common::server as CommonServer;
use bindings::host::types::types::Error;
use bindings::tokens::plugin::helpers as TokensHelpers;
use bindings::tokens::plugin::user as TokensUser;
use bindings::transact::plugin::intf::add_action_to_transaction;

use psibase::define_trust;
use psibase::fracpack::Pack;
mod errors;
use errors::ErrorType;
use psibase::services::invite::SubjectPublicKeyInfo;

define_trust! {
    descriptions {
        Low => "",
        Medium => "
        Medium trust grants the abilities of the Low trust level, plus these abilities:
            - Claiming premium account names
        ",
        High => "
        High trust grants the abilities of the Low trust level, plus these abilities:
            - Purchasing premium account names
        ",
    }
    functions {
        Low => [],
        Medium => [claim],
        High => [buy],
    }
}

struct PremAccountsPlugin;

impl Admin for PremAccountsPlugin {
    fn update_market_status(length: u8, enable: bool) -> Result<(), Error> {
        if HostClient::get_sender() != "config" {
            return Err(ErrorType::UpdateMarketStatusCallerDenied.into());
        }
        let packed =
            prem_accounts::action_structs::update_market_status { length, enable }.packed();
        add_action_to_transaction("update_market_status", &packed)?;
        Ok(())
    }

    fn add_market(length: u8) -> Result<(), Error> {
        if HostClient::get_sender() != "config" {
            return Err(ErrorType::AddMarketCallerDenied.into());
        }
        if length < 1 || length > 15 {
            return Err(ErrorType::AddMarketLengthInvalid.into());
        }
        let packed = prem_accounts::action_structs::add_market { length }.packed();
        add_action_to_transaction("add_market", &packed)?;
        Ok(())
    }
}

impl Api for PremAccountsPlugin {
    fn buy(account: String, max_cost: String) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::buy)?;

        let service_account = "prem-accounts";

        let sys_token_id = match TokensHelpers::fetch_network_token()? {
            Some(id) => id,
            None => return Err(ErrorType::SystemTokenNotDefined.into()),
        };

        let max_cost = max_cost.trim().to_string();
        if max_cost.is_empty() {
            return Err(ErrorType::MaxCostNotCanonicalDecimal.into());
        }

        let max_cost_u64 = match TokensHelpers::decimal_to_u64(sys_token_id, &max_cost) {
            Ok(v) => v,
            Err(_) => return Err(ErrorType::MaxCostNotCanonicalDecimal.into()),
        };
        let canonical = match TokensHelpers::u64_to_decimal(sys_token_id, max_cost_u64) {
            Ok(v) => v,
            Err(_) => return Err(ErrorType::MaxCostNotCanonicalDecimal.into()),
        };
        if canonical != max_cost {
            return Err(ErrorType::MaxCostNotCanonicalDecimal.into());
        }

        TokensUser::credit(
            sys_token_id,
            service_account,
            &max_cost,
            "premium account purchase",
        )?;

        let packed_buy_args = prem_accounts::action_structs::buy {
            account: account.clone(),
            max_cost: max_cost_u64,
        }
        .packed();

        let result = add_action_to_transaction("buy", &packed_buy_args);
        if result.is_err() {
            // TODO: if tx fails, pull back credit; if succeeds, pull back change
            TokensUser::uncredit(
                sys_token_id,
                service_account,
                &max_cost,
                "account purchase failed",
            )?;
            return Err(ErrorType::AccountPurchaseFailed(account.to_string()).into());
        }
        Ok(())
    }

    fn claim(account: String) -> Result<String, Error> {
        trust::assert_authorized(trust::FunctionName::claim)?;

        let keypair = AuthSigKeyVault::generate_unmanaged_keypair()?;

        // The pub_key string is PEM format
        // SubjectPublicKeyInfo expects DER-encoded bytes
        let pem_data = pem::parse(keypair.public_key.trim())
            .map_err(|e| ErrorType::InvalidPublicKey(format!("Failed to parse PEM: {}", e)))?;

        if pem_data.tag() != "PUBLIC KEY" {
            return Err(ErrorType::InvalidPublicKey(format!(
                "Expected PUBLIC KEY, got {}",
                pem_data.tag()
            ))
            .into());
        }

        AuthSigKeyVault::import_key(&keypair.private_key)?;

        let packed_claim_args = prem_accounts::action_structs::claim {
            account: account.clone(),
            pub_key: SubjectPublicKeyInfo::from(pem_data.contents().to_vec()),
        }
        .packed();

        add_action_to_transaction("claim", &packed_claim_args).unwrap();

        // TOOD: error handling: cleanup if something fails
        Ok(keypair.private_key)
    }
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct GetPricesResponse {
    data: GetPricesData,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct GetPricesData {
    get_prices: Vec<MarketPriceDto>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct MarketPriceDto {
    length: u8,
    price: psibase::services::tokens::Decimal,
}

impl Queries for PremAccountsPlugin {
    // TODO: Should this query also be an action for srv-to-srv calls?
    fn get_prices() -> Result<Vec<MarketPrice>, Error> {
        let graphql_str = "query { getPrices { length price } }";

        let response = serde_json::from_str::<GetPricesResponse>(
            &CommonServer::post_graphql_get_json(&graphql_str)?,
        );

        let response =
            response.map_err(|err| ErrorType::QueryResponseParseError(err.to_string()))?;

        Ok(response
            .data
            .get_prices
            .into_iter()
            .map(|row| MarketPrice {
                length: row.length,
                price: row.price.to_string(),
            })
            .collect())
    }
}

bindings::export!(PremAccountsPlugin with_types_in bindings);
