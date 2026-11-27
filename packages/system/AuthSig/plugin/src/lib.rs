#[allow(warnings)]
mod bindings;
mod errors;
use errors::ErrorType::*;
mod helpers;
use helpers::*;
mod keys;
mod types;

use trust::*;

// Other plugins
use bindings::host::crypto::keyvault as HostCrypto;
use bindings::host::types::types as HostTypes;
use bindings::host::types::types::{Keypair, Pem};
use bindings::transact::plugin::api as Transact;

// Exported interfaces
use bindings::exports::auth_sig::plugin::{
    actions::Guest as Actions, api::Guest as Api, keyvault::Guest as KeyVault,
    partner::Guest as Partner, queries::Guest as Queries,
};
use bindings::exports::transact_hook_user_auth::{Guest as HookUserAuth, *};

// Services
use psibase::services::auth_sig::action_structs as MyService;

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
            - Act as the recovery partner of accounts you created: confirm or reject their pending changes, end their pauses, and release their freezes

        Warning: This will grant the caller the ability to control how your account is authorized, including the capability to take control of your account! Make sure you completely trust the caller's legitimacy.
        ",
    }
    functions {
        None => [generate_unmanaged_keypair, pub_from_priv, to_der, sign_explicit, can_authorize, get_pubkey, get_accounts_with_key],
        Low => [import_key],
        Medium => [create_account],
        High => [set_key, sign, confirm, reject, end_pause, unfreeze, reject_recovery],
    }
}

struct AuthSig;

impl HookUserAuth for AuthSig {
    fn on_user_auth_claim(account_name: String) -> Result<Option<Claim>, Error> {
        if !from_transact() {
            return Err(Unauthorized("on_user_auth_claim".to_string()).into());
        }

        // The verifier is the one the account stored with its key, which
        // need not be the default for the key's type.
        let record = get_key_record(&account_name)?;
        Ok(Some(Claim {
            verify_service: record.verifier,
            raw_data: AuthSig::to_der(record.key)?,
        }))
    }

    fn on_user_auth_proof(
        account_name: String,
        transaction_hash: Vec<u8>,
    ) -> Result<Option<Proof>, Error> {
        if !from_transact() {
            return Err(Unauthorized("get_proofs".to_string()).into());
        }

        let public_key = HostCrypto::to_der(&get_pubkey(&account_name)?)?;
        let signature = AuthSig::sign(transaction_hash, public_key)?;
        Ok(Some(Proof { signature }))
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
            vec![
                "host".into(),
                "x-admin".into(),
                "invite".into(),
                "namemarket".into(),
                "homepage".into(),
            ],
        )?;
        HostCrypto::import_key(&private_key)
    }
}

impl Actions for AuthSig {
    fn set_key(public_key: Pem) -> Result<(), HostTypes::Error> {
        assert_authorized_with_whitelist(
            FunctionName::set_key,
            vec!["host".into(), "namemarket".into(), "homepage".into()],
        )?;

        // This plugin holds one key per account: it is both the owner and
        // the active key. This stores it for an account that does not use
        // auth-sig yet. An account that does is refused by the service: its
        // keys change through setActive and requestOwnerChange, which this
        // plugin does not offer yet.
        let spec = psibase::services::auth_sig::KeySpec::of(AuthSig::to_der(public_key)?.into());
        Transact::add_action_to_transaction(
            <MyService::setKeys as psio::interface::Method>::NAME,
            &psio::to_pssz(&MyService::setKeys {
                owner: spec.clone(),
                active: spec,
            }),
        )?;

        Ok(())
    }

    fn create_account(new_account_name: String) -> Result<String, HostTypes::Error> {
        assert_authorized_with_whitelist(FunctionName::create_account, vec!["host".into()])?;

        let name = psibase::AccountNumber::from_exact(&new_account_name)
            .map_err(|_| ErrorType::InvalidAccountName(&new_account_name))?;

        let keypair = HostCrypto::generate_unmanaged_keypair()?;
        let key = HostCrypto::to_der(&keypair.public_key)?;

        Transact::add_action_to_transaction(
            <MyService::newAccount as psio::interface::Method>::NAME,
            // One key: it is both the owner and the active key.
            &psio::to_pssz(&MyService::newAccount {
                name,
                owner: psibase::services::auth_sig::KeySpec::of(key.clone().into()),
                active: psibase::services::auth_sig::KeySpec::of(key.into()),
            }),
        )?;

        Ok(keypair.private_key)
    }

    fn create_account_with(
        name: String,
        owner_key: String,
        owner_seq: u64,
        active_key: String,
        active_seq: u64,
    ) -> Result<(), HostTypes::Error> {
        // The trusted sign-in page and the host's own plugins, and nobody else.
        let sender = bindings::host::client::api::get_sender();
        if sender != "supervisor" && sender != "host" {
            return Err(Unauthorized("create-account-with".to_string()).into());
        }
        Transact::add_action_to_transaction(
            <MyService::newAccount as psio::interface::Method>::NAME,
            &psio::to_pssz(&MyService::newAccount {
                name: account_number(&name)?,
                owner: key_spec(&owner_key, owner_seq)?,
                active: key_spec(&active_key, active_seq)?,
            }),
        )
    }
}

/// A DER SubjectPublicKeyInfo written as hex
fn key_spec(hex: &str, seq: u64) -> Result<psibase::services::auth_sig::KeySpec, HostTypes::Error> {
    let is_hex = hex.len() % 2 == 0 && hex.bytes().all(|b| b.is_ascii_hexdigit());
    if !is_hex {
        return Err(CryptoError("public key is not hex".to_string()).into());
    }
    let der: Vec<u8> = (0..hex.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).unwrap())
        .collect();
    if psibase::verifier_for(&der).is_none() {
        return Err(CryptoError("unsupported public key".to_string()).into());
    }
    Ok(psibase::services::auth_sig::KeySpec {
        key: der.into(),
        seq,
        verifier: None,
    })
}

fn account_number(name: &str) -> Result<psibase::AccountNumber, HostTypes::Error> {
    Ok(psibase::AccountNumber::from_exact(name).map_err(|_| ErrorType::InvalidAccountName(name))?)
}

/// The recovery-partner page lives in homepage; this plugin's own app may call too.
fn partner_callers() -> Vec<String> {
    vec!["homepage".into(), "auth-sig".into()]
}

impl Partner for AuthSig {
    fn confirm(account: String) -> Result<(), HostTypes::Error> {
        assert_authorized_with_whitelist(FunctionName::confirm, partner_callers())?;
        Transact::add_action_to_transaction(
            <MyService::confirm as psio::interface::Method>::NAME,
            &psio::to_pssz(&MyService::confirm {
                account: account_number(&account)?,
            }),
        )
    }

    fn reject(account: String) -> Result<(), HostTypes::Error> {
        assert_authorized_with_whitelist(FunctionName::reject, partner_callers())?;
        Transact::add_action_to_transaction(
            <MyService::reject as psio::interface::Method>::NAME,
            &psio::to_pssz(&MyService::reject {
                account: account_number(&account)?,
            }),
        )
    }

    fn end_pause(account: String) -> Result<(), HostTypes::Error> {
        assert_authorized_with_whitelist(FunctionName::end_pause, partner_callers())?;
        Transact::add_action_to_transaction(
            <MyService::endPause as psio::interface::Method>::NAME,
            &psio::to_pssz(&MyService::endPause {
                account: account_number(&account)?,
            }),
        )
    }

    fn unfreeze(account: String, request_id: u32) -> Result<(), HostTypes::Error> {
        assert_authorized_with_whitelist(FunctionName::unfreeze, partner_callers())?;
        Transact::add_action_to_transaction(
            <MyService::unfreeze as psio::interface::Method>::NAME,
            &psio::to_pssz(&MyService::unfreeze {
                account: account_number(&account)?,
                requestId: request_id,
            }),
        )
    }

    fn reject_recovery(account: String, request_id: u32) -> Result<(), HostTypes::Error> {
        assert_authorized_with_whitelist(FunctionName::reject_recovery, partner_callers())?;
        Transact::add_action_to_transaction(
            <MyService::rejectRecovery as psio::interface::Method>::NAME,
            &psio::to_pssz(&MyService::rejectRecovery {
                account: account_number(&account)?,
                requestId: request_id,
            }),
        )
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

        // The on-chain key may hold a compressed point; the derived one never does.
        keys::same_key(&specified_pubkey, &actual_pubkey)
    }
}

impl Queries for AuthSig {
    fn get_pubkey(account: String) -> Result<Option<Pem>, HostTypes::Error> {
        assert_authorized(FunctionName::get_pubkey)?;
        find_pubkey(&account)
    }

    fn get_accounts_with_key(public_key: Pem) -> Result<Vec<String>, HostTypes::Error> {
        assert_authorized(FunctionName::get_accounts_with_key)?;
        helpers::get_accounts_with_key(&public_key)
    }
}

bindings::export!(AuthSig with_types_in bindings);
