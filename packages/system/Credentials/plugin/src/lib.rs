#[allow(warnings)]
mod bindings;

mod errors;
use errors::ErrorType::*;

use base64::plugin::url as base64;
use bindings::*;
use exports::credentials::plugin::{api::Guest as Api, types::Credential};
use exports::transact_hook_action_auth::Guest as HookActionAuth;
use host::common::{client as Client, store as Store};
use host::types::types::Error;
use sha2::Digest;
use sha2::Sha256;
use transact::plugin::{hooks::*, types::*};

use crate::bindings::host::crypto::keyvault::sign_explicit;

struct Credentials;

const DB: Store::Database = Store::Database {
    mode: Store::DbMode::NonTransactional,
    duration: Store::StorageDuration::Ephemeral,
};

fn claims() -> Store::Bucket {
    Store::Bucket::new(DB, "claims")
}

fn proofs() -> Store::Bucket {
    Store::Bucket::new(DB, "proofs")
}

impl Api for Credentials {
    fn sign_latch(credential: Credential) {
        // Implies an app can only sign for one credential at at a time in a particular call context
        claims().set(&Client::get_sender(), &credential.p256_pub);

        let hash = Sha256::digest(credential.p256_pub.as_slice());
        proofs().set(&base64::encode(hash.as_slice()), &credential.p256_priv);

        hook_action_auth();
    }
}

impl HookActionAuth for Credentials {
    fn on_action_auth_claims(action: Action) -> Result<Vec<Claim>, Error> {
        let pubkey = claims().get(&action.service);

        if pubkey.is_some() {
            return Ok(vec![Claim {
                verify_service: psibase::services::verify_sig::SERVICE.to_string(),
                raw_data: pubkey.unwrap(),
            }]);
        }
        return Ok(vec![]);
    }

    fn on_action_auth_proofs(
        claims: Vec<Claim>,
        transaction_hash: Vec<u8>,
    ) -> Result<Vec<Proof>, Error> {
        if Client::get_sender() != "transact" {
            return Err(Unauthorized("on_action_auth_proofs").into());
        }

        let mut result = Vec::new();
        for claim in claims {
            let hash = Sha256::digest(claim.raw_data.as_slice());
            if let Some(private_key) = proofs().get(&base64::encode(hash.as_slice())) {
                result.push(Proof {
                    signature: sign_explicit(&transaction_hash, &private_key)?,
                });
            }
        }

        Ok(result)
    }
}

bindings::export!(Credentials with_types_in bindings);
