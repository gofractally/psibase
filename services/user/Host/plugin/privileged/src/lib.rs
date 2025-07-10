#[allow(warnings)]
mod bindings;

use bindings::*;
use exports::host::privileged::api::Guest as Api;
use exports::host::privileged::api::OriginationData;
use host::common::client::get_sender_app;
use supervisor::bridge::intf as Supervisor;

struct HostPrivileged;

impl Api for HostPrivileged {
    fn get_active_app() -> OriginationData {
        let app = get_sender_app().app.unwrap();
        if app != "accounts" && app != "staged-tx" {
            panic!("Only accounts and staged-tx can call this function");
        }

        let active_app = Supervisor::get_active_app();
        OriginationData {
            app: active_app.app,
            origin: active_app.origin,
        }
    }
}

bindings::export!(HostPrivileged with_types_in bindings);
