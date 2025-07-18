use crate::bindings::clientdata::plugin::keyvalue as Keyvalue;

pub struct AccessGrants;

impl AccessGrants {
    pub fn set(user: &str, caller: &str, callee: &str) {
        let any_value = "1".as_bytes();
        Keyvalue::set(&format!("{user}:{callee}<-{caller}"), &any_value);
    }
    pub fn get(user: &str, caller: &str, callee: &str) -> Option<Vec<u8>> {
        Keyvalue::get(&format!("{user}:{callee}<-{caller}"))
    }
    pub fn delete(user: &str, caller: &str, callee: &str) {
        Keyvalue::delete(&format!("{user}:{callee}<-{caller}"));
    }
}

pub struct PromptId;
impl PromptId {
    pub fn get_next_id() -> u32 {
        let key = "prompt-id";
        let val = match Keyvalue::get(&key) {
            Some(value) => {
                let next_value = u32::from_le_bytes(value.try_into().unwrap()) + 1;
                Keyvalue::set(&key, &next_value.to_le_bytes().to_vec());
                next_value
            }
            None => {
                let next_value: u32 = 1;
                Keyvalue::set(&key, &next_value.to_le_bytes().to_vec());
                next_value
            }
        };
        val
    }
}

pub struct PromptContexts;
impl PromptContexts {
    fn get_key(current_user: &str, caller: &str, callee: &str) -> String {
        format!("Prompt:{current_user}:{caller}:{callee}")
    }

    pub fn add(current_user: &str, caller: &str, callee: &str) -> u32 {
        let key = Self::get_key(current_user, caller, callee);
        let val = match Keyvalue::get(&key) {
            Some(value) => u32::from_le_bytes(value.try_into().unwrap()),
            None => {
                let next_value: u32 = PromptId::get_next_id();
                Keyvalue::set(&key, &next_value.to_le_bytes().to_vec());

                // Add secondary index by prompt ID, useful for lookup
                Keyvalue::set(&next_value.to_string(), &key.as_bytes());
                next_value
            }
        };
        val
    }

    pub fn get(id: u32) -> Option<(String, String, String)> {
        match Keyvalue::get(&id.to_string()) {
            Some(value) => {
                let key = String::from_utf8(value).unwrap();
                let [_, current_user, caller, callee]: [&str; 4] =
                    key.split(':').collect::<Vec<_>>().try_into().unwrap();
                Some((
                    current_user.to_string(),
                    caller.to_string(),
                    callee.to_string(),
                ))
            }
            None => None,
        }
    }

    pub fn delete(id: u32) {
        let value = Keyvalue::get(&id.to_string());
        if let Some(value) = value {
            let key = String::from_utf8(value).unwrap();
            let [_, current_user, caller, callee]: [&str; 4] =
                key.split(':').collect::<Vec<_>>().try_into().unwrap();
            Keyvalue::delete(&Self::get_key(current_user, caller, callee));
            // Delete the secondary index
            Keyvalue::delete(&id.to_string());
        }
    }
}
