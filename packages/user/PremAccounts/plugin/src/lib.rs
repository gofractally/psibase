#[allow(warnings)]
mod bindings;

use bindings::auth_sig::plugin::keyvault as AuthSigKeyVault;
use bindings::exports::prem_accounts::plugin::api::Guest as Api;
use bindings::exports::prem_accounts::plugin::authorized::Guest as Authorized;
use bindings::exports::prem_accounts::plugin::market_admin::Guest as MarketAdmin;
use bindings::host::common::server as CommonServer;
use bindings::host::crypto::keyvault as HostCryptoKeyVault;
use bindings::tokens::plugin::helpers as TokensHelpers;
use bindings::tokens::plugin::user as TokensUser;

use psibase::services::invite::SubjectPublicKeyInfo;
use psibase::services::tokens::Quantity;
use psibase::AccountNumber;
mod errors;
use errors::ErrorType;

use psibase_plugin::{trust::*, *};

impl TrustConfig for PremAccountsPlugin {
    fn capabilities() -> Capabilities {
        Capabilities {
            low: &[],
            medium: &["Claim premium account names"],
            high: &["Purchase premium account names"],
        }
    }
}

struct PremAccountsPlugin;

impl MarketAdmin for PremAccountsPlugin {
    #[psibase_plugin::authorized(Max, whitelist = ["config"])]
    fn create(
        length: u8,
        initial_price: String,
        target: u32,
        floor_price: String,
        increase_ppm: u32,
        decrease_ppm: u32,
    ) -> Result<(), Error> {
        let sys_token_id = TokensHelpers::fetch_network_token()?
            // .map_err(|_| ErrorType::SystemTokenNotDefined)?
            .ok_or(ErrorType::SystemTokenNotDefined)?;
        let initial_price = TokensHelpers::decimal_to_u64(sys_token_id, &initial_price)?;
        let floor_price = TokensHelpers::decimal_to_u64(sys_token_id, &floor_price)?;
        prem_accounts::Wrapper::add_to_tx().create(
            length,
            Quantity::from(initial_price),
            target,
            Quantity::from(floor_price),
            increase_ppm,
            decrease_ppm,
        );
        Ok(())
    }

    #[psibase_plugin::authorized(Max, whitelist = ["config"])]
    fn configure(
        length: u8,
        window_seconds: u32,
        target: u32,
        floor_price: String,
        increase_ppm: u32,
        decrease_ppm: u32,
    ) -> Result<(), Error> {
        let sys_token_id = match TokensHelpers::fetch_network_token()? {
            Some(id) => id,
            None => return Err(ErrorType::SystemTokenNotDefined.into()),
        };
        let floor_price = TokensHelpers::decimal_to_u64(sys_token_id, &floor_price)?;
        prem_accounts::Wrapper::add_to_tx().configure(
            length,
            window_seconds,
            target,
            Quantity::from(floor_price),
            increase_ppm,
            decrease_ppm,
        );
        Ok(())
    }

    #[psibase_plugin::authorized(Max, whitelist = ["config"])]
    fn enable(length: u8) -> Result<(), Error> {
        prem_accounts::Wrapper::add_to_tx().enable(length);
        Ok(())
    }

    #[psibase_plugin::authorized(Max, whitelist = ["config"])]
    fn disable(length: u8) -> Result<(), Error> {
        prem_accounts::Wrapper::add_to_tx().disable(length);
        Ok(())
    }
}

impl Api for PremAccountsPlugin {
    #[psibase_plugin::authorized(High, whitelist = ["accounts"])]
    fn buy(account: String, max_cost: String) -> Result<(), Error> {
        let acct_name = AccountNumber::from_exact(account.trim()).unwrap();

        let service_account = prem_accounts::SERVICE.to_string();

        let sys_token_id = match TokensHelpers::fetch_network_token()? {
            Some(id) => id,
            None => return Err(ErrorType::SystemTokenNotDefined.into()),
        };

        let max_cost = max_cost.trim().to_string();
        let max_cost_u64 = TokensHelpers::decimal_to_u64(sys_token_id, &max_cost)?;
        let canonical = TokensHelpers::u64_to_decimal(sys_token_id, max_cost_u64)?;
        if canonical != max_cost {
            return Err(ErrorType::MaxCostNotCanonicalDecimal.into());
        }

        let length = account.to_string().len() as u8;
        let ask_u64 = require_active_premium_market_ask(length, sys_token_id)?;
        if max_cost_u64 < ask_u64 {
            return Err(ErrorType::MaxCostBelowCurrentAsk.into());
        }

        TokensUser::credit(
            sys_token_id,
            &service_account,
            &max_cost,
            "premium account purchase",
        )?;

        prem_accounts::Wrapper::add_to_tx().buy(acct_name);

        Ok(())
    }

    #[psibase_plugin::authorized(Medium, whitelist = ["accounts"])]
    fn claim(account: String) -> Result<String, Error> {
        let account = AccountNumber::from_exact(account.trim()).unwrap();

        let keypair = AuthSigKeyVault::generate_unmanaged_keypair().unwrap();

        AuthSigKeyVault::import_key(&keypair.private_key).unwrap();

        prem_accounts::Wrapper::add_to_tx().claim(
            account,
            SubjectPublicKeyInfo::from(HostCryptoKeyVault::to_der(&keypair.public_key).unwrap()),
        );

        Ok(keypair.private_key)
    }
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

/// Resolves sparse configured markets: missing row → not offered; disabled → unavailable; else current ask
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
        return Err(ErrorType::PremiumNameMarketDisabled.into());
    }

    let row = response
        .data
        .current_prices
        .iter()
        .find(|p| p.length == length);

    let Some(row) = row else {
        return Err(ErrorType::QueryResponseParseError(
            "missing price row for configured premium name market".into(),
        )
        .into());
    };

    let price_str = row.price.to_string();
    TokensHelpers::decimal_to_u64(sys_token_id, &price_str)
        .map_err(|_| ErrorType::QueryResponseParseError("invalid price".into()).into())
}

impl Authorized for PremAccountsPlugin {
    #[psibase_plugin::authorized(Medium, whitelist = ["accounts"])]
    fn graphql(query: String) -> Result<String, Error> {
        CommonServer::post_graphql_get_json(&query)
    }
}

bindings::export!(PremAccountsPlugin with_types_in bindings);
