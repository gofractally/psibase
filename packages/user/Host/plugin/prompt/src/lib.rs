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
    fn get_active_prompt() -> Result<PromptDetails, Error> {
        assert_eq!(get_sender(), "supervisor", "Unauthorized");
        Ok(ActivePrompts::get().unwrap().into())
    }

    fn store_context(packed_context: Vec<u8>) -> String {
        PromptContexts::get_id(packed_context)
    }
}

impl Api for HostPrompt {
    fn prompt(prompt_name: String, packed_context: Option<Vec<u8>>) {
        assert!(
            prompt_name.chars().all(|c| c.is_ascii_alphanumeric()),
            "[Error] Invalid prompt name. Prompt name must be [a-zA-Z0-9]."
        );

        let context_id = packed_context.map(|packed_context| Self::store_context(packed_context));

        ActivePrompts::set(prompt_name, context_id);

        request_prompt();
    }

    fn get_context(context_id: String) -> Result<Vec<u8>, Error> {
        Ok(PromptContexts::get(context_id.clone())
            .ok_or_else(|| Error::from(ErrorType::PromptContextNotFound(context_id.clone())))?)
    }
}

bindings::export!(HostPrompt with_types_in bindings);
