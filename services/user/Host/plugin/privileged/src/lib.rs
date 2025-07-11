#[allow(warnings)]
mod bindings;

use bindings::*;
use exports::host::privileged::api::Guest as Api;
use exports::host::privileged::api::OriginationData;
use host::common::client::get_sender_app;
use supervisor::bridge::intf as Supervisor;

struct HostPrivileged;


bindings::export!(HostPrivileged with_types_in bindings);
