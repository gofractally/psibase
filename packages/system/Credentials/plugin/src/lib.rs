#[allow(warnings)]
mod bindings;

use bindings::*;
use exports::credentials::plugin::{api::Guest as Api, types::Credential};
use host::crypto::keyvault as HostCrypto;
use transact::plugin::intf as Transact;
use transact::plugin::types::Claim;

struct Credentials;

impl Api for Credentials {
    fn sign_latch(credential: Credential) {
        let pubkey_pem = HostCrypto::import_temporary(&credential.p256_priv)
            .expect("host:crypto::import_temporary failed");
        let pubkey_der = HostCrypto::to_der(&pubkey_pem).expect("host:crypto::to_der failed");

        let claim = Claim {
            verify_service: psibase::services::verify_sig::SERVICE.to_string(),
            raw_data: pubkey_der,
        };
        Transact::add_signature(&claim).expect("transact::add_signature failed");
    }
}

bindings::export!(Credentials with_types_in bindings);
