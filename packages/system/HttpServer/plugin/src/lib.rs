#[allow(warnings)]
mod bindings;

use bindings::exports::http_server::plugin::api::Guest as Api;
use psibase::{services::http_server, AccountNumber};
use psibase_plugin::Transact;

struct HttpServerPlugin;

impl Api for HttpServerPlugin {
    fn set_homepage_domain(subdomain: String) {
        let subdomain = AccountNumber::from_exact(subdomain.as_str())
            .expect("Subdomain must be a valid account name");
        http_server::Wrapper::add_to_tx().setHomepage(subdomain);
    }
}
bindings::export!(HttpServerPlugin with_types_in bindings);
