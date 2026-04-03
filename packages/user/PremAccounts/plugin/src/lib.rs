#[allow(warnings)]
mod bindings;

use bindings::auth_sig::plugin::keyvault as AuthSigKeyVault;
use bindings::exports::prem_accounts::plugin::api::Guest as Api;
use bindings::exports::prem_accounts::plugin::market_admin::Guest as MarketAdmin;
use bindings::exports::prem_accounts::plugin::queries::Guest as Queries;
use bindings::exports::prem_accounts::plugin::queries::MarketPrice;
use bindings::host::common::client as HostClient;
use bindings::host::common::server as CommonServer;
use bindings::host::types::types::Error;
use bindings::tokens::plugin::helpers as TokensHelpers;
use bindings::tokens::plugin::user as TokensUser;
use bindings::transact::plugin::intf::add_action_to_transaction;

use prem_accounts::constants::{MAX_PREMIUM_NAME_LENGTH, MIN_PREMIUM_NAME_LENGTH};

use psibase::define_trust;
use psibase::fracpack::Pack;
use psibase::AccountNumber;
mod errors;
use errors::ErrorType;
use psibase::services::invite::SubjectPublicKeyInfo;

fn validate_premium_account_name(account: &str) -> Result<(), Error> {
    let len = account.len();
    if !(MIN_PREMIUM_NAME_LENGTH as usize..=MAX_PREMIUM_NAME_LENGTH as usize).contains(&len) {
        return Err(ErrorType::InvalidPremiumAccountName.into());
    }
    AccountNumber::from_exact(account)
        .map(|_| ())
        .map_err(|_| ErrorType::InvalidPremiumAccountName.into())
}

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

impl MarketAdmin for PremAccountsPlugin {
    fn create(
        length: u8,
        initial_price: String,
        target: u32,
        floor_price: String,
    ) -> Result<(), Error> {
        if HostClient::get_sender() != "config" {
            return Err(ErrorType::ConfigMarketCallerDenied.into());
        }
        if length < MIN_PREMIUM_NAME_LENGTH || length > MAX_PREMIUM_NAME_LENGTH {
            return Err(ErrorType::AddMarketLengthInvalid.into());
        }
        let sys_token_id = match TokensHelpers::fetch_network_token()? {
            Some(id) => id,
            None => return Err(ErrorType::SystemTokenNotDefined.into()),
        };
        let initial_price = initial_price.trim().to_string();
        let floor_price = floor_price.trim().to_string();
        if initial_price.is_empty() || floor_price.is_empty() {
            return Err(ErrorType::MaxCostNotCanonicalDecimal.into());
        }
        let initial_price_u64 = match TokensHelpers::decimal_to_u64(sys_token_id, &initial_price) {
            Ok(v) => v,
            Err(_) => return Err(ErrorType::MaxCostNotCanonicalDecimal.into()),
        };
        let floor_price_u64 = match TokensHelpers::decimal_to_u64(sys_token_id, &floor_price) {
            Ok(v) => v,
            Err(_) => return Err(ErrorType::MaxCostNotCanonicalDecimal.into()),
        };
        let packed = prem_accounts::action_structs::create {
            length,
            initial_price: initial_price_u64,
            target,
            floor_price: floor_price_u64,
        }
        .packed();
        add_action_to_transaction("create", &packed)?;
        Ok(())
    }

    fn configure(
        length: u8,
        window_seconds: u32,
        target: u32,
        floor_price: String,
        increase_ppm: u32,
        decrease_ppm: u32,
    ) -> Result<(), Error> {
        if HostClient::get_sender() != "config" {
            return Err(ErrorType::ConfigMarketCallerDenied.into());
        }
        if length < MIN_PREMIUM_NAME_LENGTH || length > MAX_PREMIUM_NAME_LENGTH {
            return Err(ErrorType::AddMarketLengthInvalid.into());
        }
        if window_seconds == 0 {
            return Err(ErrorType::AddMarketLengthInvalid.into());
        }
        if target == 0 {
            return Err(ErrorType::AddMarketLengthInvalid.into());
        }
        if increase_ppm == 0 || increase_ppm >= 1_000_000 {
            return Err(ErrorType::AddMarketLengthInvalid.into());
        }
        if decrease_ppm == 0 || decrease_ppm >= 1_000_000 {
            return Err(ErrorType::AddMarketLengthInvalid.into());
        }
        let sys_token_id = match TokensHelpers::fetch_network_token()? {
            Some(id) => id,
            None => return Err(ErrorType::SystemTokenNotDefined.into()),
        };
        let floor_price = floor_price.trim().to_string();
        if floor_price.is_empty() {
            return Err(ErrorType::MaxCostNotCanonicalDecimal.into());
        }
        let floor_price_u64 = match TokensHelpers::decimal_to_u64(sys_token_id, &floor_price) {
            Ok(v) => v,
            Err(_) => return Err(ErrorType::MaxCostNotCanonicalDecimal.into()),
        };
        let packed = prem_accounts::action_structs::configure {
            length,
            window_seconds,
            target,
            floor_price: floor_price_u64,
            increase_ppm,
            decrease_ppm,
        }
        .packed();
        add_action_to_transaction("configure", &packed)?;
        Ok(())
    }

    fn enable(length: u8) -> Result<(), Error> {
        if HostClient::get_sender() != "config" {
            return Err(ErrorType::ConfigMarketCallerDenied.into());
        }
        if length < MIN_PREMIUM_NAME_LENGTH || length > MAX_PREMIUM_NAME_LENGTH {
            return Err(ErrorType::AddMarketLengthInvalid.into());
        }
        let packed = prem_accounts::action_structs::enable { length }.packed();
        add_action_to_transaction("enable", &packed)?;
        Ok(())
    }

    fn disable(length: u8) -> Result<(), Error> {
        if HostClient::get_sender() != "config" {
            return Err(ErrorType::ConfigMarketCallerDenied.into());
        }
        if length < MIN_PREMIUM_NAME_LENGTH || length > MAX_PREMIUM_NAME_LENGTH {
            return Err(ErrorType::AddMarketLengthInvalid.into());
        }
        let packed = prem_accounts::action_structs::disable { length }.packed();
        add_action_to_transaction("disable", &packed)?;
        Ok(())
    }
}

impl Api for PremAccountsPlugin {
    fn buy(account: String, max_cost: String) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::buy)?;

        let account = account.trim().to_string();
        validate_premium_account_name(&account)?;

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

        let length = account.len() as u8;
        let ask_u64 = require_active_premium_market_ask(length, sys_token_id)?;
        if max_cost_u64 < ask_u64 {
            return Err(ErrorType::MaxCostBelowCurrentAsk.into());
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

        let account = account.trim().to_string();
        validate_premium_account_name(&account)?;

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
    current_prices: Vec<MarketPriceDto>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct MarketPriceDto {
    length: u8,
    price: psibase::services::tokens::Decimal,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct MarketConfigLiteDto {
    length: u8,
    enabled: bool,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct MarketsOverviewData {
    market_params: Vec<MarketConfigLiteDto>,
    current_prices: Vec<MarketPriceDto>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct MarketsOverviewResponse {
    data: MarketsOverviewData,
}

/// Resolves sparse configured markets: missing row → not offered; disabled → unavailable; else current ask in raw units.
fn require_active_premium_market_ask(length: u8, sys_token_id: u32) -> Result<u64, Error> {
    let graphql_str = "query { marketParams { length enabled } currentPrices { length price } }";
    let response = serde_json::from_str::<MarketsOverviewResponse>(
        &CommonServer::post_graphql_get_json(graphql_str)?,
    );
    let response = response.map_err(|err| ErrorType::QueryResponseParseError(err.to_string()))?;

    let status = response
        .data
        .market_params
        .iter()
        .find(|s| s.length == length);

    let Some(st) = status else {
        return Err(ErrorType::PremiumNameLengthNotOffered.into());
    };

    if !st.enabled {
        return Err(ErrorType::PremiumMarketDisabled.into());
    }

    let row = response
        .data
        .current_prices
        .iter()
        .find(|p| p.length == length);

    let Some(row) = row else {
        return Err(ErrorType::QueryResponseParseError(
            "missing price row for configured premium market".into(),
        )
        .into());
    };

    let price_str = row.price.to_string();
    TokensHelpers::decimal_to_u64(sys_token_id, &price_str).map_err(|_| {
        ErrorType::QueryResponseParseError("invalid price for premium market".into()).into()
    })
}

impl Queries for PremAccountsPlugin {
    // TODO: Should this query also be an action for srv-to-srv calls?
    fn get_prices() -> Result<Vec<MarketPrice>, Error> {
        let graphql_str = "query { currentPrices { length price } }";

        let response = serde_json::from_str::<GetPricesResponse>(
            &CommonServer::post_graphql_get_json(&graphql_str)?,
        );

        let response =
            response.map_err(|err| ErrorType::QueryResponseParseError(err.to_string()))?;

        Ok(response
            .data
            .current_prices
            .into_iter()
            .map(|row| MarketPrice {
                length: row.length,
                price: row.price.to_string(),
            })
            .collect())
    }
}

bindings::export!(PremAccountsPlugin with_types_in bindings);
