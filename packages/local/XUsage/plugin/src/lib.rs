//! Plugin of the node's usage service (x-usage, gofractally/psibase#2270).
//!
//! A user's usage of a node is personal data. The service answers `/me`
//! to no web origin except the supervisor's, so a page of another app
//! cannot read it directly; an app asks for it here, through the
//! supervisor, and the call is refused unless the user trusts the caller.

#[allow(warnings)]
mod bindings;

use bindings::*;
use exports::x_usage::plugin::api::Guest as Api;
use host::http::api as Server;
use host::types::types::Error;

use crate::trust::*;

psibase::define_trust! {
    descriptions {
        Low => "",
        Medium => "",
        High => "
            - Read how much you have used of this node (requests, data transferred, transactions pushed, time spent on them)
        ",
    }
    functions {
        None => [],
        Low => [],
        High => [get_my_usage],
    }
}

struct UsagePlugin;

impl Api for UsagePlugin {
    fn get_my_usage() -> Result<String, Error> {
        assert_authorized(FunctionName::get_my_usage)?;
        // The host adds the logged-in user's query token; the service
        // answers with that account's own record and nothing else.
        Server::get_json("/me")
    }
}

bindings::export!(UsagePlugin with_types_in bindings);
