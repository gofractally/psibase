use crate::bindings::accounts::plugin::api::get_current_user;
use crate::bindings::clientdata::plugin::keyvalue as Keyvalue;
use crate::bindings::host::common::client::{self, prompt_user};
use crate::bindings::host::common::types::Error;

pub fn verify_auth_method(method: &str) -> Result<(), Error> {
    let caller = client::get_sender_app().app.unwrap();
    let callee = client::my_service_account();

    let user = get_current_user()?.unwrap();

    let res = Keyvalue::get(&format!("{user}-{caller}->{method}"));

    if !res.is_some() {
        // if access not granted, redirect calling app to this app's /permissions endpoint
        let payload = r#"{"caller":"{caller}","callee":"{callee}","user":"{user}","method":"setExampleThing","prompt":"{appname} is requesting full access to setExampleThing method."}"#
            .replace("{caller}", &caller)
            .replace("{callee}", &callee)
            .replace("{user}", &user)
            .replace("{appname}", "addpermone");
        prompt_user(Some("permissions.html"), Some(&payload))
    } else {
        Ok(())
    }
}
