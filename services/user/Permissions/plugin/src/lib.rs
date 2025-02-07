#[allow(warnings)]
mod bindings;

use bindings::exports::permissions::plugin::api::Guest as Api;
use bindings::exports::permissions::plugin::queries::Guest as Queries;
use bindings::host::common::client as HostClient;
use bindings::{clientdata::plugin::keyvalue as Keyvalue, host::common::client::get_sender_app};
// use bindings::host::common::server as CommonServer;
use bindings::host::common::types::Error;
use bindings::host::common::web as CommonWeb;
// use bindings::transact::plugin::intf::add_action_to_transaction;
// use psibase::fracpack::Pack;

mod errors;
use errors::ErrorType;
use psibase::get_service;
use serde::{Deserialize, Serialize};

struct PermissionsPlugin;

// fn prefix(&self) -> String {
//         // App data is namespaced by protocol/port because plugins
//         //  are loaded on the same protocol that the supervisor uses.
//         //  e.g. https supervisor will load https plugins and store
//         //  https data.

//         // Only allow storing data for recognized psibase apps, for now
//         self.app
//             .app
//             .clone()
//             .expect("Only psibase apps may have entries in accounts table")
//     }

#[derive(Serialize, Deserialize, Debug)]
struct SavedPermissions {
    full_permissions: bool,
}

fn verify_caller_is_this_service() -> bool {
    let requester = get_sender_app().app.unwrap();
    let this_service = get_service().to_string();
    requester != this_service
}

fn save_permission_pref(caller: String, callee: String, remember: bool) -> Result<(), Error> {
    // verify caller == permissions.psibase.io
    println!("caller: {}", caller);
    println!("callee: {}", callee);
    println!("remember: {}", remember);
    if !verify_caller_is_this_service() {
        return Err(ErrorType::InvalidRequester().into());
    }

    // TODO: FracPack this
    // let p = SavedPermissions {
    //     full_permissions: true,
    // };

    // save to local storage
    // let perms_str = serde_json::to_string(&p);
    // if perms_str.is_err() {
    //     return Err(ErrorType::PermissionsSaveError().into());
    // }
    // let perms_str = perms_str.unwrap();
    // Keyvalue::set(&caller, &perms_str.as_bytes()).expect("Failed to saved permissions preference");
    let k = format!("{callee}<-{caller}");
    Keyvalue::set(&k, &"1".as_bytes())
}

impl Api for PermissionsPlugin {
    fn save_permission(caller: String, callee: String, remember: bool) -> Result<(), Error> {
        save_permission_pref(caller, callee, remember)
    }
}

impl Queries for PermissionsPlugin {
    fn is_permitted(caller: String) -> Result<bool, Error> {
        // access_to == HostClient::get_sender_app()
        println!("caller: {}", caller);
        let callee = HostClient::get_sender_app().app.unwrap();
        println!("Permissions.get_sender_app() = {}", callee);

        // temporarily save a value
        // TASK: remove this for the real functionality once the dialog has been added
        // let _perms_res = save_permission_pref(caller.clone(), callee.clone(), true);
        // if perms_res.is_err() {
        //     println!("error saving permissions");
        // } else {
        //     println!("success saving permissions");
        // }
        // let _perms_res = perms_res.unwrap();

        // check to local storage
        let k = format!("{callee}<-{caller}");
        let perms_pref = Keyvalue::get(&k);
        println!("{:?}", perms_pref);
        // show dialog if not in local storage
        if perms_pref.is_none() {
            // show dialog
            CommonWeb::open_subpage(&format!("permissions.html?caller={caller}&callee={callee}"))?;
            return Err(ErrorType::PermissionsSaveError().into());
        } else {
            Ok(true)
            // let perms_pref = perms_pref.unwrap();
            // println!("{:?}", perms_pref);
            // let perms_str = String::from_utf8(perms_pref).unwrap();
            // println!("{:?}", perms_str);
            // let perms_strt = serde_json::from_str::<SavedPermissions>(&perms_str).unwrap();
            // println!("{:?}", perms_strt);
            // Ok(perms_strt.full_permissions)
        }
    }
}

bindings::export!(PermissionsPlugin with_types_in bindings);
