#[allow(warnings)]
mod bindings;

use bindings::accounts::plugin::api as AccountsApi;
use bindings::exports::prem_accounts::plugin::api::Guest as Api;
use bindings::exports::prem_accounts::plugin::authorized::Guest as Authorized;
use bindings::exports::prem_accounts::plugin::market_admin::Guest as MarketAdmin;
use bindings::exports::prem_accounts::plugin::market_admin::MarketConfig;
use bindings::host::common::server as CommonServer;
use bindings::tokens::plugin::helpers as TokensHelpers;
use bindings::tokens::plugin::user as TokensUser;

use psibase::services::tokens::Quantity;
use psibase::AccountNumber;
mod errors;
use errors::ErrorType;

use psibase_plugin::{trust::*, *};

const PPM_PER_PCT: u32 = 10_000;

fn pct_to_ppm(pct: u8) -> u32 {
    (pct as u32) * PPM_PER_PCT
}

fn require_adjust_pcts(increase_pct: u8, decrease_pct: u8) -> Result<(), Error> {
    if increase_pct == 0 || decrease_pct == 0 {
        return Err(ErrorType::InvalidAdjustPct.into());
    }
    Ok(())
}

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
        increase_pct: u8,
        decrease_pct: u8,
    ) -> Result<(), Error> {
        require_adjust_pcts(increase_pct, decrease_pct)?;
        let sys_token_id =
            TokensHelpers::fetch_network_token()?.ok_or(ErrorType::SystemTokenNotDefined)?;
        let initial_price = TokensHelpers::decimal_to_u64(sys_token_id, &initial_price)?;
        let floor_price = TokensHelpers::decimal_to_u64(sys_token_id, &floor_price)?;
        prem_accounts::Wrapper::add_to_tx().create(
            length,
            Quantity::from(initial_price),
            target,
            Quantity::from(floor_price),
            pct_to_ppm(increase_pct),
            pct_to_ppm(decrease_pct),
        );
        Ok(())
    }

    #[psibase_plugin::authorized(Max, whitelist = ["config"])]
    fn configure(
        length: u8,
        window_seconds: u32,
        target: u32,
        floor_price: String,
        increase_pct: u8,
        decrease_pct: u8,
    ) -> Result<(), Error> {
        require_adjust_pcts(increase_pct, decrease_pct)?;
        let sys_token_id =
            TokensHelpers::fetch_network_token()?.ok_or(ErrorType::SystemTokenNotDefined)?;
        let floor_price = TokensHelpers::decimal_to_u64(sys_token_id, &floor_price)?;
        prem_accounts::Wrapper::add_to_tx().configure(
            length,
            window_seconds,
            target,
            Quantity::from(floor_price),
            pct_to_ppm(increase_pct),
            pct_to_ppm(decrease_pct),
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

    #[psibase_plugin::authorized(Max, whitelist = ["config"])]
    fn configure_markets(configs: Vec<MarketConfig>) -> Result<(), Error> {
        if configs.is_empty() {
            return Ok(());
        }

        let sys_token_id =
            TokensHelpers::fetch_network_token()?.ok_or(ErrorType::SystemTokenNotDefined)?;
        let current_params = fetch_market_params()?;

        for cfg in configs {
            require_adjust_pcts(cfg.increase_pct, cfg.decrease_pct)?;

            let current = current_params
                .iter()
                .find(|market| market.length == cfg.length);

            if current.is_none() {
                let initial_price_str = cfg
                    .initial_price
                    .clone()
                    .filter(|s| !s.is_empty())
                    .ok_or(ErrorType::InitialPriceRequired(cfg.length))?;
                let initial_price =
                    TokensHelpers::decimal_to_u64(sys_token_id, &initial_price_str)?;
                let floor_price = TokensHelpers::decimal_to_u64(sys_token_id, &cfg.floor_price)?;
                prem_accounts::Wrapper::add_to_tx().create(
                    cfg.length,
                    Quantity::from(initial_price),
                    cfg.target,
                    Quantity::from(floor_price),
                    pct_to_ppm(cfg.increase_pct),
                    pct_to_ppm(cfg.decrease_pct),
                );

                if !cfg.enabled {
                    prem_accounts::Wrapper::add_to_tx().disable(cfg.length);
                }
                continue;
            }

            let current = current.unwrap();
            if market_params_match(current, &cfg) {
                continue;
            }

            let floor_price = TokensHelpers::decimal_to_u64(sys_token_id, &cfg.floor_price)?;
            prem_accounts::Wrapper::add_to_tx().configure(
                cfg.length,
                cfg.window_seconds,
                cfg.target,
                Quantity::from(floor_price),
                pct_to_ppm(cfg.increase_pct),
                pct_to_ppm(cfg.decrease_pct),
            );

            if current.enabled == cfg.enabled {
                continue;
            }

            if cfg.enabled {
                prem_accounts::Wrapper::add_to_tx().enable(cfg.length);
            } else {
                prem_accounts::Wrapper::add_to_tx().disable(cfg.length);
            }
        }

        Ok(())
    }
}

impl Api for PremAccountsPlugin {
    #[psibase_plugin::authorized(Medium, whitelist = ["accounts", "homepage"])]
    fn can_create_premium_account() -> bool {
        if !AccountsApi::is_logged_in() {
            return false;
        }

        let Ok(overview) = markets_overview() else {
            return false;
        };

        if TokensHelpers::fetch_network_token()
            .ok()
            .flatten()
            .is_none()
        {
            return false;
        }

        if overview.market_params.is_empty() && overview.current_prices.is_empty() {
            return false;
        }

        overview.market_params.iter().any(|market| market.enabled)
    }

    #[psibase_plugin::authorized(High, whitelist = ["accounts", "homepage"])]
    fn buy(account: String, max_cost: String) -> Result<(), Error> {
        let acct_name = AccountNumber::from_exact(&account)
            .map_err(|err| ErrorType::InvalidAccountName(err.to_string()))?;

        let service_account = prem_accounts::SERVICE.to_string();

        let sys_token_id =
            TokensHelpers::fetch_network_token()?.ok_or(ErrorType::SystemTokenNotDefined)?;

        let length = account.len() as u8;
        let ask_u64 = require_active_premium_market_ask(length, sys_token_id)?;
        let max_cost_u64 = TokensHelpers::decimal_to_u64(sys_token_id, &max_cost)?;
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

    #[psibase_plugin::authorized(Medium, whitelist = ["accounts", "homepage"])]
    fn claim(account: String) -> Result<(), Error> {
        let account = AccountNumber::from_exact(&account)
            .map_err(|_| ErrorType::InvalidAccountName(account))?;

        prem_accounts::Wrapper::add_to_tx().claim(account);

        Ok(())
    }
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct MarketPrice {
    length: u8,
    price: psibase::services::tokens::Decimal,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct MarketConfigLite {
    length: u8,
    enabled: bool,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct MarketsOverviewData {
    market_params: Vec<MarketConfigLite>,
    current_prices: Vec<MarketPrice>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct MarketsOverviewResponse {
    data: MarketsOverviewData,
}

fn markets_overview() -> Result<MarketsOverviewData, Error> {
    let graphql_str = "query { marketParams { length enabled } currentPrices { length price } }";
    serde_json::from_str::<MarketsOverviewResponse>(&CommonServer::post_graphql_get_json(
        graphql_str,
    )?)
    .map_err(|err| ErrorType::QueryResponseParseError(err.to_string()).into())
    .map(|response| response.data)
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct MarketParamsRow {
    length: u8,
    enabled: bool,
    target: u32,
    floor_price: String,
    window_seconds: u32,
    increase_ppm: u32,
    decrease_ppm: u32,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct MarketParamsData {
    market_params: Vec<MarketParamsRow>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct MarketParamsResponse {
    data: MarketParamsData,
}

fn fetch_market_params() -> Result<Vec<MarketParamsRow>, Error> {
    let graphql_str =
        "query { marketParams { length enabled target floorPrice windowSeconds increasePpm decreasePpm } }";
    serde_json::from_str::<MarketParamsResponse>(&CommonServer::post_graphql_get_json(
        graphql_str,
    )?)
    .map_err(|err| ErrorType::QueryResponseParseError(err.to_string()).into())
    .map(|response| response.data.market_params)
}

fn market_params_match(current: &MarketParamsRow, requested: &MarketConfig) -> bool {
    current.enabled == requested.enabled
        && current.target == requested.target
        && current.window_seconds == requested.window_seconds
        && current.increase_ppm == pct_to_ppm(requested.increase_pct)
        && current.decrease_ppm == pct_to_ppm(requested.decrease_pct)
        && prices_match(&current.floor_price, &requested.floor_price)
}

fn prices_match(current: &str, requested: &str) -> bool {
    current.trim() == requested.trim()
}

/// Resolves sparse configured markets: missing row means not offered; disabled means unavailable; else current ask
fn require_active_premium_market_ask(length: u8, sys_token_id: u32) -> Result<u64, Error> {
    let overview = markets_overview()?;

    let status = overview.market_params.iter().find(|s| s.length == length);

    let Some(st) = status else {
        return Err(ErrorType::NameLengthUnavailable.into());
    };

    if !st.enabled {
        return Err(ErrorType::NameLengthUnavailable.into());
    }

    let row = overview.current_prices.iter().find(|p| p.length == length);

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
    #[psibase_plugin::authorized(Medium, whitelist = ["accounts", "homepage"])]
    fn graphql(query: String) -> Result<String, Error> {
        CommonServer::post_graphql_get_json(&query)
    }
}

bindings::export!(PremAccountsPlugin with_types_in bindings);
