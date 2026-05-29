use crate::bindings::auth_sig::plugin as AuthSig;
use crate::bindings::exports::accounts::plugin::api::Guest;
use crate::bindings::exports::accounts::plugin::prompt::{Credential, Guest as Prompt};
use crate::bindings::host::{
    auth::api as HostAuth, common::client as Client, crypto::keyvault as HostCrypto,
    types::types::Error,
};
use crate::bindings::invite::plugin::redemption as Invites;
use crate::bindings::prem_accounts::plugin::api as PremAccounts;
use crate::bindings::prem_accounts::plugin::authorized as PremAccountsAuth;
use crate::bindings::tokens::plugin::helpers as TokensHelpers;
use crate::bindings::transact::plugin::intf as Transact;
use crate::db::{apps_table::AppsTable, user_table::UserTable};
use crate::errors::ErrorType;
use crate::helpers::{max_cost_with_slippage, premium_market_ask};
use crate::plugin::AccountsPlugin;
use psibase::fracpack::Pack;
use psibase::services::{accounts as AccountsService, auth_sig};
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PremiumMarketConfig {
    length: u8,
    enabled: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PremiumMarketPrice {
    length: u8,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PremiumMarketsOverview {
    market_params: Vec<PremiumMarketConfig>,
    current_prices: Vec<PremiumMarketPrice>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PremiumMarketsOverviewResponse {
    data: PremiumMarketsOverview,
}

fn premium_markets_overview() -> Option<PremiumMarketsOverview> {
    let query = "query { marketParams { length enabled } currentPrices { length } }";
    let response = PremAccountsAuth::graphql(query).ok()?;
    serde_json::from_str::<PremiumMarketsOverviewResponse>(&response)
        .ok()
        .map(|r| r.data)
}

impl Prompt for AccountsPlugin {
    fn can_create_account() -> bool {
        assert_eq!(Client::get_sender(), Client::get_receiver());

        if Self::is_logged_in() {
            return true;
        }

        if let Some(can_create_account) = Invites::get_active_invite() {
            return can_create_account;
        }

        false
    }

    fn can_create_premium_account() -> bool {
        assert_eq!(Client::get_sender(), Client::get_receiver());

        if !Self::is_logged_in() {
            return false;
        }

        // Failure to get a query response from prem-accounts/plugin/authorized::graphql implies
        // PremAccounts package isn't installed/configured/active.
        let Some(overview) = premium_markets_overview() else {
            return false;
        };

        if TokensHelpers::fetch_network_token()
            .ok()
            .flatten()
            .is_none()
        {
            return false;
        }

        // At least one market exists and is enabled (with a live price row).
        if overview.market_params.is_empty() && overview.current_prices.is_empty() {
            return false;
        }
        overview.market_params.iter().any(|market| {
            market.enabled
                && overview
                    .current_prices
                    .iter()
                    .any(|price| price.length == market.length)
        })
    }

    fn import_existing(credentials: Vec<Credential>) -> Result<(), Vec<(String, Error)>> {
        assert_eq!(Client::get_sender(), Client::get_receiver());

        let mut invalid_accounts = Vec::new();
        for credential in credentials {
            match AccountsPlugin::get_account(credential.account.to_string()) {
                Ok(Some(account)) => match account.auth_service.as_str() {
                    "auth-any" => {
                        AppsTable::new(&Client::get_receiver()).connect(&credential.account);
                    }
                    "auth-sig" => {
                        let account_str = credential.account.to_string();
                        if !AuthSig::api::can_authorize(&credential.key, &account_str) {
                            invalid_accounts.push((
                                credential.account,
                                ErrorType::AuthorizationFailed(account_str).into(),
                            ));
                            continue;
                        }

                        if let Err(e) = AuthSig::keyvault::import_key(&credential.key) {
                            invalid_accounts.push((credential.account, e));
                        } else {
                            AppsTable::new(&Client::get_receiver()).connect(&credential.account);
                        }
                    }
                    service => {
                        invalid_accounts.push((
                            credential.account,
                            ErrorType::UnsupportedAuthService(service.to_string()).into(),
                        ));
                    }
                },
                Ok(None) => {
                    let account_str = credential.account.clone();
                    invalid_accounts.push((
                        credential.account,
                        ErrorType::AccountNotFound(account_str).into(),
                    ));
                }
                Err(e) => {
                    invalid_accounts.push((credential.account, e));
                }
            }
        }

        if invalid_accounts.is_empty() {
            Ok(())
        } else {
            Err(invalid_accounts)
        }
    }

    fn create_account(account_name: String) -> Result<String, Error> {
        assert_eq!(Client::get_sender(), Client::get_receiver());

        let private_key;

        if Self::is_logged_in() {
            private_key = AuthSig::actions::create_account(&account_name)?;
        } else if Invites::get_active_invite().unwrap_or(false) {
            private_key = Invites::create_new_account(&account_name);
        } else {
            println!("Neither logged in nor has active invite");
            return Err(ErrorType::CannotCreateAccount().into());
        }

        Ok(private_key)
    }

    fn create_premium(account_name: String, max_cost: String) -> Result<String, Error> {
        assert_eq!(Client::get_sender(), Client::get_receiver());

        if account_name.len() >= AccountsService::MIN_FREE_ACCOUNT_NAME_LENGTH {
            return Self::create_account(account_name);
        }

        if !Self::can_create_premium_account() {
            return Err(ErrorType::CannotCreatePremiumAccount().into());
        }

        PremAccounts::buy(&account_name, &max_cost)?;
        PremAccounts::claim(&account_name)?;

        let keypair = HostCrypto::generate_unmanaged_keypair()?;

        Transact::set_propose_latch(Some(&account_name))?;
        AuthSig::actions::set_key(&keypair.public_key)?;
        Transact::add_action_to_transaction(
            AccountsService::action_structs::setAuthServ::ACTION_NAME,
            &AccountsService::action_structs::setAuthServ {
                authService: auth_sig::Wrapper::SERVICE,
            }
            .packed(),
        )?;
        Transact::set_propose_latch(None)?;

        Ok(keypair.private_key)
    }

    fn connect_account(account: String) {
        assert_eq!(Client::get_sender(), Client::get_receiver());

        // The account must already have been imported
        assert!(AppsTable::new(&Client::get_receiver())
            .get_connected_accounts()
            .contains(&account));

        let app = Client::get_active_app();
        AppsTable::new(&app).login(&account);
        UserTable::new(&account).add_connected_app(&app);

        if HostAuth::set_logged_in_user(&account, &app).is_err() {
            AppsTable::new(&app).logout();
            UserTable::new(&account).remove_connected_app(&app);
        }

        if let Some(_) = Invites::get_active_invite() {
            Invites::accept();
        }
    }
}
