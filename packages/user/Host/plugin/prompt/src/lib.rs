#[allow(warnings)]
mod bindings;
use bindings::*;

mod errors;
use errors::ErrorType;

mod db;
use db::*;

use exports::host::prompt::admin::PromptDetails;
use exports::host::prompt::{admin::Guest as Admin, api::Guest as Api};
use host::common::client::get_sender;
use host::types::types::Error;
use supervisor::bridge::prompt::request_prompt;
struct HostPrompt;

impl Admin for HostPrompt {
    fn get_active_prompt() -> PromptDetails {
        assert_eq!(get_sender(), "supervisor", "Unauthorized");
        ActivePrompts::get().unwrap().into()
    }

    fn store_context(packed_context: Vec<u8>) {
        assert_eq!(get_sender(), "supervisor", "Unauthorized");
        ActivePrompts::set_context(packed_context);
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
        let prompt = ActivePrompts::get().unwrap();
        prompt
            .packed_context
            .ok_or_else(|| Error::from(ErrorType::PromptContextNotFound(prompt.prompt_name)))
    }
}

bindings::export!(HostPrompt with_types_in bindings);
