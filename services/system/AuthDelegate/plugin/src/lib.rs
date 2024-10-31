#[allow(warnings)]
mod bindings;
mod errors;
use errors::ErrorType::*;

// Other plugins
use bindings::accounts::smart_auth::types::{Action, Claim, Proof};
use bindings::host::common::types as CommonTypes;

// Exported interfaces
use bindings::exports::accounts::smart_auth::smart_auth::Guest as SmartAuth;

struct AuthDelegate;

impl SmartAuth for AuthDelegate {
    fn get_claims(
        _account_name: String,
        _actions: Vec<Action>,
    ) -> Result<Vec<Claim>, CommonTypes::Error> {
        Err(NotYetImplemented.err("get_claims"))
    }

    fn get_proofs(
        _account_name: String,
        _transaction_hash: Vec<u8>,
    ) -> Result<Vec<Proof>, CommonTypes::Error> {
        Err(NotYetImplemented.err("get_proofs"))
    }
}

bindings::export!(AuthDelegate with_types_in bindings);
