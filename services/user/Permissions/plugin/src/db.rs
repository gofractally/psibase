use crate::bindings::accounts::plugin::api as Accounts;
use crate::bindings::clientdata::plugin::keyvalue as Keyvalue;

pub struct AccessGrants;

impl AccessGrants {
    pub fn set(caller: &str, callee: &str) {
        let any_value = "1".as_bytes();
        let user = Accounts::get_current_user()
            .unwrap()
            .expect("Failed to get current user");
        Keyvalue::set(&format!("{user}:{callee}<-{caller}"), &any_value)
            .expect("Failed to set access grant")
    }
    pub fn get(caller: &str, callee: &str) -> Option<Vec<u8>> {
        let user = Accounts::get_current_user()
            .unwrap()
            .expect("Failed to get current user");
        Keyvalue::get(&format!("{user}:{callee}<-{caller}"))
    }
}
