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
}

impl Api for HostPrompt {
    fn prompt_user(prompt_name: String, context_id: Option<String>) -> Result<(), Error> {
        if !prompt_name.chars().all(|c| c.is_ascii_alphanumeric()) {
            return Err(ErrorType::InvalidPromptName().into());
        }

        ActivePrompts::set(prompt_name, context_id);

        Ok(request_prompt()?)
    }

    fn store_context(packed_context: Vec<u8>) -> String {
        PromptContexts::get_id(packed_context)
    }

    fn get_context(context_id: String) -> Result<Vec<u8>, Error> {
        Ok(PromptContexts::get(context_id.clone())
            .ok_or_else(|| Error::from(ErrorType::PromptContextNotFound(context_id.clone())))?)
    }
}

bindings::export!(HostPrompt with_types_in bindings);
