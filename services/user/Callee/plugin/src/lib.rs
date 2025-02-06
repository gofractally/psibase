#[allow(warnings)]
mod bindings;

// use bindings::exports::callee::plugin::api::Guest as Api;
use bindings::exports::callee::plugin::queries::Guest as Queries;
use bindings::host::common::client::get_sender_app;
use bindings::permissions::plugin::queries::is_permitted;
use errors::ErrorType;
// use bindings::host::common::server as CommonServer;
use bindings::host::common::types::Error;
// use bindings::transact::plugin::intf::add_action_to_transaction;

// use psibase::fracpack::Pack;

mod errors;
// use errors::ErrorType;

struct CalleePlugin;

impl Queries for CalleePlugin {
    fn get_private_data() -> Result<String, Error> {
        // ask Permissions if this caller can call this callee
        let caller = get_sender_app().app.unwrap();
        println!("Callee.get_sender_app() = {}", caller);
        let is_permitted = is_permitted(&caller)?;
        println!("Callee.is_permitted = {}", is_permitted);
        // return data or error if no permitted
        if !is_permitted {
            return Err(ErrorType::QueryNotPermittedError().into());
        }
        Ok(String::from("private data"))
    }
}

bindings::export!(CalleePlugin with_types_in bindings);
