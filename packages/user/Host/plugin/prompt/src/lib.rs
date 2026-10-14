#[allow(warnings)]
mod bindings;
use bindings::*;

mod errors;
use errors::ErrorType;

mod db;
use db::*;

use chrono::Utc;
use exports::host::prompt::admin::PromptDetails;
use exports::host::prompt::{admin::Guest as Admin, api::Guest as Api};
use host::client::api::get_sender;
use host::types::types::Error;
use supervisor::bridge::prompt::request_prompt;
struct HostPrompt;

fn assert_supervisor() {
    assert_eq!(get_sender(), "supervisor", "Unauthorized");
}

impl Admin for HostPrompt {
    fn get_active_prompt() -> PromptDetails {
        assert_supervisor();
        ActivePrompts::get().expect("No active prompt").into()
    }

    fn clear_active_prompt() {
        assert_supervisor();
        ActivePrompts::clear();
    }
}

fn validate_prompt_name(prompt_name: &str) {
    assert!(
        prompt_name.chars().all(|c| c.is_ascii_alphanumeric()),
        "[Error] Invalid prompt name. Prompt name must be [a-zA-Z0-9]."
    );
}

impl Api for HostPrompt {
    fn prompt(prompt_name: String, packed_context: Option<Vec<u8>>) {
        validate_prompt_name(&prompt_name);
        ActivePrompts::set(prompt_name, packed_context);
        request_prompt();
    }

    fn get_context() -> Result<Vec<u8>, Error> {
        let prompt = ActivePrompts::get().expect("No active prompt");
        assert_eq!(get_sender(), prompt.prompt_app, "Unauthorized");
        assert!(!prompt.is_expired(Utc::now()), "This prompt has expired.");
        prompt
            .packed_context
            .ok_or_else(|| Error::from(ErrorType::PromptContextNotFound(prompt.prompt_name)))
    }
}

bindings::export!(HostPrompt with_types_in bindings);
