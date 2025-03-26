use crate::bindings::clientdata::plugin::keyvalue as Keyvalue;

pub struct AccessGrants;

impl AccessGrants {
    pub fn set(caller: &str, callee: &str) {
        let any_value = "1".as_bytes();
        Keyvalue::set(&format!("{callee}<-{caller}"), &any_value)
            .expect("Failed to set access grant")
    }
    pub fn get(caller: &str, callee: &str) -> Option<Vec<u8>> {
        Keyvalue::get(&format!("{callee}<-{caller}"))
    }
}
