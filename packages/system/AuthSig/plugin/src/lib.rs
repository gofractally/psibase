#[allow(warnings)]
mod bindings;
mod errors;
use errors::ErrorType::*;
mod helpers;
use helpers::*;
mod types;

use trust::*;

// Other plugins
use bindings::{
    accounts::plugin as AccountsPlugin,
    host::{
        common::client as Client,
        crypto::keyvault as HostCrypto,
        types::types::{self as HostTypes, Claim, Error, Keypair, Pem},
    },
    transact::plugin::intf as Transact,
};

// Exported interfaces
use bindings::exports::auth_sig::plugin::{
    actions::Guest as Actions, api::Guest as Api, keyvault::Guest as KeyVault,
    session::Guest as Session,
};

// Services
use psibase::services::auth_sig::action_structs as MyService;

use psibase::fracpack::Pack;

use crate::errors::ErrorType;

psibase::define_trust! {
    descriptions {
        Low => "
            - Import keypairs
        ",
        Medium => "
            - Create new accounts
        ",
        High => "
            - Set the public key for your account
            - Sign transactions on your behalf

        Warning: This will grant the caller the ability to control how your account is authorized, including the capability to take control of your account! Make sure you completely trust the caller's legitimacy.
        ",
    }
    functions {
        None => [generate_unmanaged_keypair, pub_from_priv, to_der, sign_explicit, can_authorize],
        Low => [import_key],
        Medium => [create_account],
        High => [set_key, sign],
    }
}

struct AuthSig;

fn resolve_credential(account_name: &str) -> Result<Claim, Error> {
    let pubkey_der = AuthSig::to_der(get_pubkey(account_name)?)?;
    Ok(Claim {
        verify_service: psibase::services::verify_sig::SERVICE.to_string(),
        raw_data: pubkey_der,
    })
}

fn do_authorize(account_name: &str) -> Result<Claim, Error> {
    let claim = resolve_credential(account_name)?;
    Transact::add_signature(&claim)?;
    Ok(claim)
}

impl Session for AuthSig {
    fn authorize(account_name: String) -> Result<(), Error> {
        if Client::get_sender() != "supervisor" {
            return Err(Unauthorized("session::authorize".to_string()).into());
        }

        do_authorize(&account_name)?;
        Ok(())
    }

    fn login(account_name: String) -> Result<(), Error> {
        if Client::get_sender() != "accounts" {
            return Err(Unauthorized("session::login".to_string()).into());
        }

        // We authorize on login, because there are some cases where accounts will attempt to
        //   schedule a transaction on behalf of the account that was just logged in (e.g. invite acceptance)
        // The `authorize` is done here because it wasn't done by the supervisor on tx_start because
        //   the account wasn't logged in yet.
        let claim = do_authorize(&account_name)?;

        AccountsPlugin::auth_svc::login(&account_name, Some(&claim))
    }
}

impl KeyVault for AuthSig {
    fn generate_unmanaged_keypair() -> Result<Keypair, HostTypes::Error> {
        assert_authorized(FunctionName::generate_unmanaged_keypair)?;
        HostCrypto::generate_unmanaged_keypair()
    }

    fn pub_from_priv(private_key: Pem) -> Result<Pem, HostTypes::Error> {
        assert_authorized(FunctionName::pub_from_priv)?;
        HostCrypto::pub_from_priv(&private_key)
    }

    fn to_der(key: Pem) -> Result<Vec<u8>, HostTypes::Error> {
        assert_authorized(FunctionName::to_der)?;
        HostCrypto::to_der(&key)
    }

    fn sign_explicit(
        hashed_message: Vec<u8>,
        private_key: Vec<u8>,
    ) -> Result<Vec<u8>, HostTypes::Error> {
        assert_authorized(FunctionName::sign_explicit)?;
        HostCrypto::sign_explicit(&hashed_message, &private_key)
    }

    fn sign(hashed_message: Vec<u8>, public_key: Vec<u8>) -> Result<Vec<u8>, HostTypes::Error> {
        assert_authorized_with_whitelist(FunctionName::sign, vec!["transact".into()])?;
        HostCrypto::sign(&hashed_message, &public_key)
    }

    fn import_key(private_key: Pem) -> Result<Pem, HostTypes::Error> {
        assert_authorized_with_whitelist(
            FunctionName::import_key,
            vec!["accounts".into(), "x-admin".into(), "invite".into()],
        )?;
        HostCrypto::import_key(&private_key)
    }
}

impl Actions for AuthSig {
    fn set_key(public_key: Pem) -> Result<(), HostTypes::Error> {
        assert_authorized(FunctionName::set_key)?;

        Transact::add_action_to_transaction(
            MyService::setKey::ACTION_NAME,
            &MyService::setKey {
                key: AuthSig::to_der(public_key)?.into(),
            }
            .packed(),
        )?;

        Ok(())
    }

    fn create_account(new_account_name: String) -> Result<String, HostTypes::Error> {
        assert_authorized_with_whitelist(FunctionName::create_account, vec!["accounts".into()])?;

        let name = psibase::AccountNumber::from_exact(&new_account_name)
            .map_err(|_| ErrorType::InvalidAccountName(&new_account_name))?;

        let keypair = HostCrypto::generate_unmanaged_keypair()?;
        let key = HostCrypto::to_der(&keypair.public_key)?;

        Transact::add_action_to_transaction(
            MyService::newAccount::ACTION_NAME,
            &MyService::newAccount {
                name,
                key: key.into(),
            }
            .packed(),
        )?;

        Ok(keypair.private_key)
    }
}

impl Api for AuthSig {
    fn can_authorize(private_key: Pem, account_name: String) -> bool {
        if let Err(e) = assert_authorized(FunctionName::can_authorize) {
            panic!("Auth failure: {}", e.message);
        }

        let Ok(specified_pubkey) = Self::pub_from_priv(private_key) else {
            println!("Failed to convert specified private key to public key.");
            return false;
        };
        let Ok(actual_pubkey) = get_pubkey(&account_name) else {
            println!("Failed to retrieve public key for specified account");
            return false;
        };

        specified_pubkey == actual_pubkey
    }
}

bindings::export!(AuthSig with_types_in bindings);
