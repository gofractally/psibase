use crate::bindings::exports::host::prompt::admin::PromptDetails;
use crate::host::client::api::{get_active_app, get_sender};
use crate::host::db::store::{DbMode::*, StorageDuration::*, *};
use chrono::{DateTime, Duration, Utc};
use psibase::fracpack::{Pack, Unpack};

/// Seconds until a prompt is too old to read. Matches the supervisor prompt page window.
const PROMPT_EXPIRATION_SECS: i64 = 300;

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

    pub fn is_expired(&self, now: DateTime<Utc>) -> bool {
        let created_at = self
            .created
            .parse::<DateTime<Utc>>()
            .expect("prompt created time");
        now.signed_duration_since(created_at) > Duration::seconds(PROMPT_EXPIRATION_SECS)
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
        let val = tables::active_prompt().get(PROMPT_KEY)?;
        Some(ActivePrompt::unpacked(&val).unwrap())
    }

    pub fn clear() {
        tables::active_prompt().delete(PROMPT_KEY);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn prompt(created: &str) -> ActivePrompt {
        ActivePrompt {
            prompt_app: "host".into(),
            active_app: "homepage".into(),
            prompt_name: "connect".into(),
            created: created.into(),
            packed_context: None,
        }
    }

    fn at(rfc3339: &str) -> DateTime<Utc> {
        rfc3339.parse().unwrap()
    }

    #[test]
    fn at_window_boundary() {
        assert!(!prompt("2026-01-01T00:00:00+00:00").is_expired(at("2026-01-01T00:05:00Z")));
    }
}
