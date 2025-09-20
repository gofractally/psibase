#[allow(warnings)]
mod bindings;

mod errors;
use errors::ErrorType::*;

use auth_sig::plugin::keyvault::sign;
use bindings::*;
use exports::credentials::plugin::{api::Guest as Api, types::Credential};
use exports::transact_hook_action_auth::Guest as HookActionAuth;
use host::common::{client as Client, store as Store};
use host::types::types::Error;
use transact::plugin::{hooks::*, types::*};

struct Credentials;

const DB: Store::Database = Store::Database {
    mode: Store::DbMode::NonTransactional,
    duration: Store::StorageDuration::Ephemeral,
};

fn bucket() -> Store::Bucket {
    Store::Bucket::new(DB, &Client::get_sender())
}

impl Api for Credentials {
    fn sign_latch(credential: Credential) {
        let bucket = bucket();
        bucket.set("pub", &credential.p256_pub);
        bucket.set("priv", &credential.p256_priv);

        hook_action_auth();
    }
}

impl HookActionAuth for Credentials {
    fn on_action_auth_claims(_: Action) -> Result<Vec<Claim>, Error> {
        let pubkey = bucket().get("pub").expect("Missing credential");

        return Ok(vec![Claim {
            verify_service: credentials::VERIFY_SERVICE.to_string(),
            raw_data: pubkey,
        }]);
    }

    fn on_action_auth_proofs(
        _claims: Vec<Claim>,
        transaction_hash: Vec<u8>,
    ) -> Result<Vec<Proof>, Error> {
        if Client::get_sender() != "transact" {
            return Err(Unauthorized("on_action_auth_proofs").into());
        }

        let private_key = bucket().get("priv").expect("Missing credential");

        Ok(vec![Proof {
            signature: sign(&transaction_hash, &private_key)?,
        }])
    }
}

bindings::export!(Credentials with_types_in bindings);
