use crate::bindings::clientdata::plugin::keyvalue as Keyvalue;

pub struct AccessGrants;

impl AccessGrants {
    pub fn set(user: &str, caller: &str, callee: &str) {
        let any_value = "1".as_bytes();
        Keyvalue::set(&format!("{user}:{callee}<-{caller}"), &any_value)
            .expect("Failed to set access grant")
    }
    pub fn get(user: &str, caller: &str, callee: &str) -> Option<Vec<u8>> {
        Keyvalue::get(&format!("{user}:{callee}<-{caller}"))
    }
    pub fn delete(user: &str, caller: &str, callee: &str) {
        Keyvalue::delete(&format!("{user}:{callee}<-{caller}"));
    }
}
