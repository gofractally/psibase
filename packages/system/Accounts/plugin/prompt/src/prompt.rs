use crate::apps_table::AppsTable;
use crate::bindings::auth_any::plugin as AuthAny;
use crate::bindings::auth_sig::plugin as AuthSig;
use crate::bindings::exports::accounts::prompt::prompt::{Credential, Guest as Prompt};
use crate::bindings::host::{
    common::client as Client, crypto::keyvault as HostCrypto, types::types::Error,
};
use crate::bindings::invite::plugin::redemption as Invites;
use crate::bindings::name_market::plugin::api as NameMarket;
use crate::bindings::transact::plugin::intf as Transact;
use crate::errors::ErrorType;
use crate::helpers;
use crate::trust::*;
use crate::AccountsPrompt;
use psibase::fracpack::Pack;
use psibase::services::accounts as AccountsService;
use psibase::services::auth_sig;

impl Prompt for AccountsPrompt {
    fn can_create_account() -> bool {
        assert_eq!(Client::get_sender(), Client::get_receiver());

        if helpers::is_logged_in() {
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
            match helpers::get_account(credential.account.to_string()) {
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

        if helpers::is_logged_in() {
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
        Transact::add_action_to_transaction(
            AccountsService::action_structs::setAuthServ::ACTION_NAME,
            &AccountsService::action_structs::setAuthServ {
                authService: auth_sig::Wrapper::SERVICE,
            }
            .packed(),
        )?;
        Transact::set_propose_latch(None)?;

        AuthSig::keyvault::import_key(&keypair.private_key)?;

        Ok(keypair.private_key)
    }

    fn login(account: String) -> Result<(), Error> {
        assert_eq!(Client::get_sender(), Client::get_receiver());

        let Some(account_info) = helpers::get_account(account.clone())? else {
            return Err(ErrorType::AccountNotFound(account).into());
        };

        match account_info.auth_service.as_str() {
            "auth-sig" => AuthSig::session::login(&account),
            "auth-any" => AuthAny::session::login(&account),
            service => Err(ErrorType::UnsupportedAuthService(service.to_string()).into()),
        }
    }
}
