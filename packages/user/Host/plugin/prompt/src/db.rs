use crate::bindings::exports::host::prompt::admin::PromptDetails;
use crate::host::client::api::{get_active_app, get_sender};
use crate::host::db::store::{DbMode::*, StorageDuration::*, *};
use chrono::Utc;


mod tables {
    use super::*;

    pub fn active_prompt() -> Bucket {
        Bucket::new(
            Database {
                mode: NonTransactional,
                // Persistent, not Session: the prompt is recorded by the
                // supervisor embedded in the app's page and read by the
                // supervisor's own top-level prompt page. Session storage is
                // not shared between a frame and a top-level page in WebKit,
                // so Safari reported "No prompt is active". The prompt page
                // refuses a prompt older than a few minutes (`created`).
                duration: Persistent,
            },
            "active-prompt",
        )
    }
}

#[derive(psio::PsszPack, psio::PsszUnpack, psio::PsszView, psio::ToPsszSchema, psio::JsonText)]
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
        tables::active_prompt().set(PROMPT_KEY, &psio::to_pssz(&prompt));
    }

    /// The active prompt, or nothing if there is none (or what is stored is
    /// not one).
    pub fn get() -> Option<ActivePrompt> {
        let val = tables::active_prompt().get(PROMPT_KEY)?;
        psio::from_pssz::<ActivePrompt>(&val).ok()
    }
}
