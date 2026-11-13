//! TEST ONLY: see ../README.md.
#[allow(warnings)]
mod bindings;

use bindings::exports::host::e2e_probe_user::api::Guest as Api;
use bindings::host::e2e_probe::res::{EagerProbe, LazyProbe};
use bindings::host::types::types::Error;

struct ProbeUser;

impl Api for ProbeUser {
    fn lazy_fetch(endpoint: String) -> Result<String, Error> {
        LazyProbe::new(&endpoint).fetch()
    }

    fn eager_body(endpoint: String) -> String {
        EagerProbe::new(&endpoint).body()
    }
}

bindings::export!(ProbeUser with_types_in bindings);
