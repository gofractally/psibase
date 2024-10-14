#[allow(warnings)]
mod bindings;
mod errors;
use errors::ErrorType::*;

// Other plugins
use bindings::accounts::smart_auth::types::{Action, Claim, Proof};
use bindings::auth_sig::plugin::types::{Keypair, Pem};
use bindings::clientdata::plugin::keyvalue as Keyvalue;
use bindings::host::common::{client as Client, server as Server, types as CommonTypes};
use bindings::transact::plugin::intf as Transact;

// Exported interfaces
use bindings::exports::accounts::smart_auth::smart_auth::Guest as SmartAuth;
use bindings::exports::auth_sig::plugin::{actions::Guest as Actions, keyvault::Guest as KeyVault};

// Services
use psibase::services::auth_sig::action_structs as MyService;

// Third-party crates
use p256::ecdsa::{signature::Signer, Signature, SigningKey, VerifyingKey};
use p256::pkcs8::{DecodePrivateKey, EncodePrivateKey, EncodePublicKey, LineEnding};
use psibase::fracpack::Pack;
use rand_core::OsRng;
use seahash;

trait TryFromPemStr: Sized {
    fn try_from_pem_str(p: &Pem) -> Result<Self, CommonTypes::Error>;
}

impl TryFromPemStr for pem::Pem {
    fn try_from_pem_str(key_string: &Pem) -> Result<Self, CommonTypes::Error> {
        Ok(pem::parse(key_string.trim()).map_err(|e| CryptoError.err(&e.to_string()))?)
    }
}

fn get_hash(key: &Pem) -> Result<String, CommonTypes::Error> {
    let pem = pem::Pem::try_from_pem_str(&key)?;
    let digest = seahash::hash(&pem.contents().to_vec());
    Ok(format!("{:x}", digest))
}

fn from_transact() -> bool {
    Client::get_sender_app().app.map_or(false, |app| {
        app == psibase::services::transact::SERVICE.to_string()
    })
}

struct AuthSig;

impl SmartAuth for AuthSig {
    fn get_claims(
        account_name: String,
        _actions: Vec<Action>,
    ) -> Result<Vec<Claim>, CommonTypes::Error> {
        if !from_transact() {
            return Err(Unauthorized.err("get_claims"));
        }

        let current_user = Client::get_logged_in_user()?;
        if current_user.is_none() || current_user.unwrap() != account_name {
            // Why is transact asking for the claims of another user?
            // There may be a legitimate use-case for this, but I'd rather block
            //   it for now until the use-case is clear.
            return Err(Unauthorized.err("get_claims"));
        }

        let user_key_json = Server::post_graphql_get_json(&format!(
            "query {{ account(name: \"{}\") {{ pubkey }} }}",
            account_name
        ))?;
        println!("Found user key: {}", user_key_json);

        // let hash = get_hash(&user_key)?;
        // let key = Keyvalue::get(&hash);
        // if key.is_none() {
        //     return Err(KeyNotFound.err("get_claims"));
        // }
        // let key = key.unwrap();

        // Claim {
        //     verify_service: psibase::services::verify_sig::SERVICE.to_string(),
        //     raw_data: key,
        // }

        Err(NotYetImplemented.err("get_claim"))
    }

    fn get_proofs(
        _account_name: String,
        _message: Vec<u8>,
    ) -> Result<Vec<Proof>, CommonTypes::Error> {
        if !from_transact() {
            return Err(Unauthorized.err("get_proofs"));
        }

        Err(NotYetImplemented.err("get_proof"))
    }
}

impl KeyVault for AuthSig {
    fn generate_keypair() -> Result<String, CommonTypes::Error> {
        let keypair = AuthSig::generate_unmanaged_keypair()?;
        let hash = get_hash(&keypair.public_key)?;
        Keyvalue::set(&hash, &AuthSig::to_der(keypair.private_key)?)?;
        Ok(keypair.public_key)
    }

    fn generate_unmanaged_keypair() -> Result<Keypair, CommonTypes::Error> {
        let signing_key = SigningKey::random(&mut OsRng);
        let verifying_key: &VerifyingKey = signing_key.verifying_key();

        let private_key = signing_key
            .to_pkcs8_pem(LineEnding::LF)
            .map_err(|e| CryptoError.err(&e.to_string()))?
            .to_string();
        let public_key = verifying_key
            .to_public_key_pem(LineEnding::LF)
            .map_err(|e| CryptoError.err(&e.to_string()))?;

        Ok(Keypair {
            public_key,
            private_key,
        })
    }

    fn pub_from_priv(private_key: Pem) -> Result<Pem, CommonTypes::Error> {
        let pem = pem::Pem::try_from_pem_str(&private_key)?;
        let signing_key = SigningKey::from_pkcs8_der(&pem.contents())
            .map_err(|e| CryptoError.err(&e.to_string()))?;
        let verifying_key = signing_key.verifying_key();

        Ok(verifying_key
            .to_public_key_pem(LineEnding::LF)
            .map_err(|e| CryptoError.err(&e.to_string()))?)
    }

    fn to_der(key: Pem) -> Result<Vec<u8>, CommonTypes::Error> {
        let pem = pem::Pem::try_from_pem_str(&key)?;
        Ok(pem.contents().to_vec())
    }

    fn sign(message: Vec<u8>, private_key: Vec<u8>) -> Result<Vec<u8>, CommonTypes::Error> {
        let signing_key = SigningKey::from_pkcs8_der(&private_key)
            .map_err(|e| CryptoError.err(&e.to_string()))?;
        let signature: Signature = signing_key.sign(&message);
        Ok(signature.to_bytes().to_vec())
    }
}

impl Actions for AuthSig {
    fn set_key(public_key: Pem) -> Result<(), CommonTypes::Error> {
        // TODO: check if sender authorizes caller app to set key
        // Currently only an AuthSig app would be able to set a user's key
        let auth = Client::get_sender_app().app.map_or(false, |app| {
            app == psibase::services::auth_sig::SERVICE.to_string()
        });
        if !auth {
            return Err(Unauthorized.err("set_key"));
        }

        Transact::add_action_to_transaction(
            MyService::setKey::ACTION_NAME,
            &MyService::setKey {
                key: AuthSig::to_der(public_key)?.into(),
            }
            .packed(),
        )?;

        Ok(())
    }
}

bindings::export!(AuthSig with_types_in bindings);
