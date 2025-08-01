use crate::host::common::store::{DbMode::*, StorageDuration::*, *};

mod tables {
    use super::*;

    pub fn prompt_ids() -> Bucket {
        Bucket::new(
            Database {
                mode: NonTransactional,
                duration: Session,
            },
            "prompt-ids",
        )
    }

    pub fn prompt_contexts_by_id() -> Bucket {
        Bucket::new(
            Database {
                mode: NonTransactional,
                duration: Session,
            },
            "prompt-contexts-by-id",
        )
    }
}

pub struct PromptId;
impl PromptId {
    pub fn get_next_id() -> u32 {
        let prompt_ids = tables::prompt_ids();
        let val = match prompt_ids.get("next") {
            Some(value) => {
                let next_value = u32::from_le_bytes(value.try_into().unwrap()) + 1;
                prompt_ids.set("next", &next_value.to_le_bytes().to_vec());
                next_value
            }
            None => {
                let next_value: u32 = 1;
                prompt_ids.set("next", &next_value.to_le_bytes().to_vec());
                next_value
            }
        };
        val
    }
}

pub struct PromptContexts;
impl PromptContexts {
    pub fn get_id(packed_context: Vec<u8>) -> String {
        let id: u32 = PromptId::get_next_id();
        tables::prompt_contexts_by_id().set(&id.to_string(), &packed_context);
        id.to_string()
    }

    pub fn get(id: String) -> Option<Vec<u8>> {
        tables::prompt_contexts_by_id().get(&id)
    }
}
