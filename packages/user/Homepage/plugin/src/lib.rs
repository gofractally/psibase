#[allow(warnings)]
mod bindings;
use bindings::*;

use exports::homepage::plugin::premium_accounts::Guest as PremiumAccountsApi;
use host::types::types::Error;

const AUTH_SIG_SERVICE: &str = "auth-sig";

struct HomepagePlugin;

impl PremiumAccountsApi for HomepagePlugin {
    fn claim_and_set_key(account: String) -> Result<String, Error> {
        prem_accounts::plugin::api::claim(&account)?;

        let keypair = host::crypto::keyvault::generate_unmanaged_keypair()?;

        transact::plugin::intf::set_propose_latch(Some(&account))?;
        auth_sig::plugin::actions::set_key(&keypair.public_key)?;
        accounts::plugin::api::set_auth_service(AUTH_SIG_SERVICE)?;
        transact::plugin::intf::set_propose_latch(None)?;

        auth_sig::plugin::keyvault::import_key(&keypair.private_key)?;

        Ok(keypair.private_key)
    }
}

bindings::export!(HomepagePlugin with_types_in bindings);
