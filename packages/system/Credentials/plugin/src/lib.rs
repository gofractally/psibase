#[allow(warnings)]
mod bindings;

use bindings::*;
use exports::credentials::plugin::api::Guest as Api;
use host::crypto::keyvault as HostCrypto;
use host::types::types::{Claim, Pem};
use transact::plugin::intf as Transact;

struct Credentials;

impl Api for Credentials {
    fn use_p256_credential(p256_priv: Pem) {
        let pubkey_pem = HostCrypto::import_key_transient(&p256_priv)
            .expect("host:crypto::import_key_transient failed");
        let pubkey_der = HostCrypto::to_der(&pubkey_pem).expect("host:crypto::to_der failed");

        let claim = Claim {
            verify_service: psibase::services::verify_sig::SERVICE.to_string(),
            raw_data: pubkey_der,
        };
        Transact::add_signature(&claim).expect("transact::add_signature failed");
    }
}

bindings::export!(Credentials with_types_in bindings);
