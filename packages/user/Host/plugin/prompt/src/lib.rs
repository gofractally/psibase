#[allow(warnings)]
mod bindings;
use bindings::*;

mod errors;
use errors::ErrorType;

mod db;
use db::*;

use exports::host::prompt::api::TriggerDetails;
use exports::host::prompt::{api::Guest as Api, web::Guest as Web};
use host::common::client::get_sender;
use host::types::types::Error;
use platform::bridge::prompt::request_prompt;
use psibase::fracpack::{Pack, Unpack};

use chrono::Utc;
use clientdata::plugin::keyvalue as KeyValue;
use rand::Rng;

struct HostPrompt;

#[derive(Pack, Unpack)]
struct ActivePrompt {
    id: u32,
    subdomain: String,
    payload: String, // e.g. subpath for web platform
    expiry_timestamp: u32,
    context_id: Option<String>,
    return_payload: Option<String>, // e.g. subpath on subdomain for web platform
}

const PROMPT_EXPIRATION_SEC: u32 = 2 * 60;
const ACTIVE_PROMPT_REQ: &str = "active_prompt_request";

impl Api for HostPrompt {
    fn get_prompt_trigger_details(
        id: String,
        return_payload: String,
    ) -> Result<TriggerDetails, Error> {
        assert_eq!(get_sender(), "supervisor", "Unauthorized");

        let id = id.parse::<u32>().unwrap();

        let val = KeyValue::get(ACTIVE_PROMPT_REQ).ok_or(ErrorType::NoActivePrompt())?;
        let mut details = <ActivePrompt>::unpacked(&val).unwrap();

        if id != details.id {
            return Err(ErrorType::PromptNotFound(id).into());
        }

        if Utc::now().timestamp() as u32 >= details.expiry_timestamp {
            KeyValue::delete(ACTIVE_PROMPT_REQ);
            return Err(ErrorType::PromptExpired(id).into());
        }

        // Update the prompt with the registered return path
        details.return_payload = Some(return_payload);
        KeyValue::set(ACTIVE_PROMPT_REQ, &details.packed());

        Ok(TriggerDetails {
            subdomain: details.subdomain,
            payload: details.payload,
            context_id: details.context_id,
        })
    }

    fn get_return_details(id: String) -> Option<String> {
        assert_eq!(get_sender(), "supervisor", "Unauthorized");

        let val = KeyValue::get(ACTIVE_PROMPT_REQ).unwrap();
        let details = <ActivePrompt>::unpacked(&val).unwrap();
        assert_eq!(id.parse::<u32>().unwrap(), details.id);

        // If the return URL is being requested, it implies that the prompt has been finished
        // and we are redirecting back to the caller app. Therefore, the prompt can be deleted.
        KeyValue::delete(ACTIVE_PROMPT_REQ);

        details.return_payload
    }
}

impl Web for HostPrompt {
    fn prompt_user(prompt_name: String, context_id: Option<String>) -> Result<(), Error> {
        if !prompt_name.chars().all(|c| c.is_ascii_alphanumeric()) {
            return Err(ErrorType::InvalidPromptName().into());
        }

        // Store the active prompt in the host's namespace
        let id: u32 = rand::rng().random();
        KeyValue::set(
            ACTIVE_PROMPT_REQ,
            &ActivePrompt {
                id,
                subdomain: get_sender(),
                payload: prompt_name,
                expiry_timestamp: Utc::now().timestamp() as u32 + PROMPT_EXPIRATION_SEC,
                context_id,
                return_payload: None,
            }
            .packed(),
        );

        request_prompt(&format!("{}", id))
            .map_err(|err| Error::from(ErrorType::OpenPromptError(err)))?;

        Ok(())
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
