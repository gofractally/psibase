use crate::bindings::exports::host::prompt::api::PromptDetails;
use crate::host::common::client::{get_active_app, get_sender};
use crate::host::common::store::{DbMode::*, StorageDuration::*, *};
use chrono::Utc;
use psibase::fracpack::{Pack, Unpack};

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

    pub fn active_prompts() -> Bucket {
        Bucket::new(
            Database {
                mode: NonTransactional,
                duration: Session,
            },
            "active-prompts",
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

#[derive(Pack, Unpack)]
pub struct ActivePrompt {
    pub subdomain: String,
    pub active_app: String, // Currently active application
    pub prompt_name: String,
    pub created: String,
    pub context_id: Option<String>,
    pub return_payload: Option<String>, // e.g. subpath on subdomain for web platform
}

impl From<ActivePrompt> for PromptDetails {
    fn from(prompt: ActivePrompt) -> Self {
        PromptDetails {
            subdomain: prompt.subdomain,
            active_app: prompt.active_app,
            prompt_name: prompt.prompt_name,
            context_id: prompt.context_id,
            created: prompt.created,
        }
    }
}

const PROMPT_KEY: &str = "prompt";
pub struct ActivePrompts;
impl ActivePrompts {
    pub fn set(prompt_name: String, context_id: Option<String>) {
        let prompt = ActivePrompt {
            subdomain: get_sender(),
            active_app: get_active_app(),
            prompt_name,
            created: Utc::now().to_rfc3339(),
            context_id,
            return_payload: None,
        };
        tables::active_prompts().set(PROMPT_KEY, &prompt.packed());
    }

    pub fn get() -> Option<ActivePrompt> {
        let val = tables::active_prompts().get(PROMPT_KEY).unwrap();
        Some(<ActivePrompt>::unpacked(&val).unwrap())
    }
}
