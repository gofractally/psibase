use crate::bindings::host::common::client::{self, prompt_user};

const ACCESS_GRANTS: [(&str, &str); 1] = [("app1", "setExampleThing")];

pub fn verify_auth_method(method: &str) {
    let caller = client::get_sender_app().app.unwrap();
    if !ACCESS_GRANTS.contains(&(&caller, method)) {
        // if access not granted, redirect calling app to this app's /permissions endpoint
        prompt_user(
            Some("permissions"),
            Some(&format!("\{\"caller\":\"{}\",\"method\":\"setExampleThing\",\"prompt\":\"app1 is requesting full access to setExampleThing method.\"\}", caller)),
        )
        .unwrap();
    }
}
