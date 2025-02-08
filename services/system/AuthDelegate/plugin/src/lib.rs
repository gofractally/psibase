#[allow(warnings)]
mod bindings;
mod errors;
use errors::ErrorType::*;

// Other plugins
use bindings::exports::transact_hook_user_auth::{Guest as HookUserAuth, *};
use bindings::host::common::types as CommonTypes;

struct AuthDelegate;

impl HookUserAuth for AuthDelegate {
    fn on_user_auth_claim(_account_name: String) -> Result<Option<Claim>, CommonTypes::Error> {
        Err(NotYetImplemented("get_claims"))?
    }

    fn on_user_auth_proof(
        _account_name: String,
        _transaction_hash: Vec<u8>,
    ) -> Result<Option<Proof>, CommonTypes::Error> {
        Err(NotYetImplemented("get_proofs"))?
    }
}

bindings::export!(AuthDelegate with_types_in bindings);
