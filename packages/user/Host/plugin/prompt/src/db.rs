use crate::bindings::exports::host::prompt::admin::PromptDetails;
use crate::host::common::client::{get_active_app, get_sender};
use crate::host::common::store::{DbMode::*, StorageDuration::*, *};
use chrono::Utc;
use psibase::fracpack::{Pack, Unpack};

mod tables {
    use super::*;

    pub fn active_prompt() -> Bucket {
        Bucket::new(
            Database {
                mode: NonTransactional,
                duration: Session,
            },
            "active-prompt",
        )
    }
}

#[derive(Pack, Unpack)]
pub struct ActivePrompt {
    pub prompt_app: String,
    pub active_app: String, // Currently active application
    pub prompt_name: String,
    pub created: String,
    pub packed_context: Option<Vec<u8>>,
}

impl ActivePrompt {
    pub fn new(prompt_name: String, packed_context: Option<Vec<u8>>) -> Self {
        Self {
            prompt_app: get_sender(),
            prompt_name,
            active_app: get_active_app(),
            created: Utc::now().to_rfc3339(),
            packed_context,
        }
    }
}

impl From<ActivePrompt> for PromptDetails {
    fn from(prompt: ActivePrompt) -> Self {
        PromptDetails {
            prompt_app: prompt.prompt_app,
            prompt_name: prompt.prompt_name,
            active_app: prompt.active_app,
            created: prompt.created,
            packed_context: prompt.packed_context,
        }
    }
}

const PROMPT_KEY: &str = "prompt";
pub struct ActivePrompts;
impl ActivePrompts {
    pub fn set(prompt_name: String, packed_context: Option<Vec<u8>>) {
        let prompt = ActivePrompt::new(prompt_name, packed_context);
        tables::active_prompt().set(PROMPT_KEY, &prompt.packed());
    }

    pub fn get() -> Option<ActivePrompt> {
        let val = tables::active_prompt().get(PROMPT_KEY).unwrap();
        Some(<ActivePrompt>::unpacked(&val).unwrap())
    }

    pub fn set_context(packed_context: Vec<u8>) {
        let mut prompt = Self::get().unwrap();
        prompt.packed_context = Some(packed_context);
        tables::active_prompt().set(PROMPT_KEY, &prompt.packed());
    }
}
