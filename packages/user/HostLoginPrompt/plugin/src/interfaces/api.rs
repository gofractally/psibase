use crate::bindings::accounts::plugin::api as AccountsPlugin;
use crate::bindings::accounts::query::api as AccountsQuery;
use crate::bindings::auth_sig::plugin as AuthSig;
use crate::bindings::exports::host::login_prompt::api::{Credential, Guest as Api};
use crate::bindings::host::{
    client::api as Client, crypto::keyvault as HostCrypto, accounts::admin as HostAccountsAdmin,
    accounts::api as HostAccountsApi, types::types::Error,
};
use crate::bindings::invite::plugin::redemption as Invites;
use crate::bindings::name_market::plugin::api as NameMarket;
use crate::bindings::transact::plugin::api as Transact;
use crate::errors::ErrorType;
use crate::helpers::KNOWN_ACCOUNTS_APP;
use crate::plugin::LoginPrompt;
use crate::trust::*;
use psibase::services::accounts as AccountsService;
use psibase::services::auth_sig;

impl Api for LoginPrompt {
    fn can_create_account() -> bool {
        assert_eq!(Client::get_sender(), Client::get_receiver());

        if HostAccountsApi::is_logged_in() {
            return true;
        }

        if let Some(can_create_account) = Invites::get_active_invite() {
            return can_create_account;
        }

        false
    }

    fn import_existing(credentials: Vec<Credential>) -> Result<(), Vec<(String, Error)>> {
        assert_authorized_with_whitelist(FunctionName::import_existing, vec!["homepage".into()])
            .unwrap();

        let mut invalid_accounts = Vec::new();
        for credential in credentials {
            match AccountsQuery::get_account(&credential.account) {
                Ok(Some(account)) => match account.auth_service.as_str() {
                    "auth-any" => {
                        HostAccountsAdmin::connect(&credential.account, KNOWN_ACCOUNTS_APP);
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
                            HostAccountsAdmin::connect(&credential.account, KNOWN_ACCOUNTS_APP);
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

        if HostAccountsApi::is_logged_in() {
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
        assert!(HostAccountsAdmin::get_connected_accounts(KNOWN_ACCOUNTS_APP).contains(&account));

        let app = Client::get_active_app();
        HostAccountsAdmin::add_connected_app(&account, &app);

        if HostAccountsAdmin::login(&account, &app).is_err() {
            HostAccountsAdmin::remove_connected_app(&account, &app);
        }

        if Invites::get_active_invite().is_some() {
            Invites::accept();
        }
    }
}
