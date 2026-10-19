use crate::bindings::accounts::plugin::api as AccountsPlugin;
use crate::bindings::auth_sig::plugin as AuthSig;
use crate::bindings::exports::host::login_prompt::api::{Credential, Guest as Api};
use crate::bindings::host::{
    auth::api as HostAuth, client::api as Client, crypto::keyvault as HostCrypto,
    types::types::Error, wallet::admin as HostWalletAdmin,
};
use crate::bindings::invite::plugin::redemption as Invites;
use crate::bindings::name_market::plugin::{api as NameMarket, types::MarketsOverview};
use crate::bindings::tokens::plugin::{
    helpers as TokensHelpers,
    types::{SystemTokenInfo, UserBalance},
};
use crate::bindings::transact::plugin::api as Transact;
use crate::errors::ErrorType;
use crate::plugin::LoginPrompt;
use crate::HOST_APP;
use psibase::services::accounts as AccountsService;
use psibase::services::auth_sig;
impl Api for LoginPrompt {
    fn can_create_account() -> bool {
        assert_eq!(Client::get_sender(), Client::get_receiver());

        if HostAuth::is_logged_in() {
            return true;
        }

        if let Some(can_create_account) = Invites::get_active_invite() {
            return can_create_account;
        }

        false
    }

    fn import_existing(credentials: Vec<Credential>) -> Result<(), Vec<(String, Error)>> {
        assert_eq!(Client::get_sender(), Client::get_receiver());
        HostWalletAdmin::import_existing(&credentials)
    }

    fn create_account(account_name: String) -> Result<String, Error> {
        assert_eq!(Client::get_sender(), Client::get_receiver());

        let private_key;

        if HostAuth::is_logged_in() {
            private_key = AuthSig::actions::create_account(&account_name)?;
        } else if Invites::get_active_invite().unwrap_or(false) {
            private_key = Invites::create_new_account(&account_name);
        } else {
            return Err(ErrorType::CannotCreateAccount().into());
        }

        Ok(private_key)
    }

    fn create_premium(account_name: String, max_cost: String) -> Result<String, Error> {
        assert_eq!(Client::get_sender(), Client::get_receiver());

        if account_name.len() >= AccountsService::MIN_ALLOWED_ACCOUNT_LENGTH.into() {
            return Self::create_account(account_name);
        }

        if !NameMarket::can_create_account() {
            return Err(ErrorType::CannotCreateAccount().into());
        }

        NameMarket::buy(&account_name, &max_cost)?;
        NameMarket::claim(&account_name)?;

        let keypair = HostCrypto::generate_unmanaged_keypair()?;

        Transact::set_propose_latch(Some(&account_name))?;
        AuthSig::actions::set_key(&keypair.public_key)?;
        AccountsPlugin::set_auth_service(&auth_sig::Wrapper::SERVICE.to_string())?;
        Transact::set_propose_latch(None)?;

        AuthSig::keyvault::import_key(&keypair.private_key)?;

        Ok(keypair.private_key)
    }

    fn connect_account(account: String) {
        assert_eq!(Client::get_sender(), Client::get_receiver());

        // The account must already have been imported
        assert!(HostWalletAdmin::get_connected_accounts(HOST_APP).contains(&account));

        let app = Client::get_active_app();
        HostWalletAdmin::add_connected_app(&account, &app);

        if HostWalletAdmin::login_to_app(&account, &app).is_err() {
            HostWalletAdmin::remove_connected_app(&account, &app);
        }

        if Invites::get_active_invite().is_some() {
            Invites::accept();
        }
    }

    fn get_system_token() -> Result<Option<SystemTokenInfo>, Error> {
        assert_eq!(Client::get_sender(), Client::get_receiver());
        TokensHelpers::get_system_token()
    }

    fn get_user_balances(user: String) -> Result<Vec<UserBalance>, Error> {
        assert_eq!(Client::get_sender(), Client::get_receiver());
        TokensHelpers::get_user_balances(&user)
    }

    fn can_buy_account() -> bool {
        assert_eq!(Client::get_sender(), Client::get_receiver());
        NameMarket::can_create_account()
    }

    fn get_markets_overview() -> Result<MarketsOverview, Error> {
        assert_eq!(Client::get_sender(), Client::get_receiver());
        NameMarket::get_markets_overview()
    }
}
