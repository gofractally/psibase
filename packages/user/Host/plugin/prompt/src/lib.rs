#[allow(warnings)]
mod bindings;
use bindings::*;

mod errors;
use errors::ErrorType;

mod db;
use db::*;

use exports::host::prompt::api::PromptDetails;
use exports::host::prompt::{api::Guest as Api, web::Guest as Web};
use host::common::client::{get_active_app, get_sender};
use host::types::types::Error;
use psibase::fracpack::{Pack, Unpack};
use supervisor::bridge::prompt::request_prompt;

use chrono::Utc;
use clientdata::plugin::keyvalue as KeyValue;

struct HostPrompt;

#[derive(Pack, Unpack)]
struct ActivePrompt {
    subdomain: String,
    active_app: String, // Currently active application
    payload: String,    // e.g. subpath for web platform
    expiry_timestamp: u32,
    context_id: Option<String>,
    return_payload: Option<String>, // e.g. subpath on subdomain for web platform
}

const PROMPT_EXPIRATION_SEC: u32 = 10;
const ACTIVE_PROMPT_REQ: &str = "active_prompt_request";

impl Api for HostPrompt {
    fn get_active_prompt() -> Result<PromptDetails, Error> {
        assert_eq!(get_sender(), "supervisor", "Unauthorized");

        let val = KeyValue::get(ACTIVE_PROMPT_REQ).ok_or(ErrorType::NoActivePrompt())?;
        let details = <ActivePrompt>::unpacked(&val).unwrap();

        Ok(PromptDetails {
            subdomain: details.subdomain,
            active_app: details.active_app,
            payload: details.payload,
            context_id: details.context_id,
            expired: Utc::now().timestamp() as u32 >= details.expiry_timestamp,
        })
    }

    fn delete_active_prompt() {
        assert_eq!(get_sender(), "supervisor", "Unauthorized");
        KeyValue::delete(ACTIVE_PROMPT_REQ);
    }
}

impl Web for HostPrompt {
    fn prompt_user(prompt_name: String, context_id: Option<String>) -> Result<(), Error> {
        if !prompt_name.chars().all(|c| c.is_ascii_alphanumeric()) {
            return Err(ErrorType::InvalidPromptName().into());
        }

        // Store the active prompt in the host's namespace
        KeyValue::set(
            ACTIVE_PROMPT_REQ,
            &ActivePrompt {
                subdomain: get_sender(),
                active_app: get_active_app(),
                payload: prompt_name,
                expiry_timestamp: Utc::now().timestamp() as u32 + PROMPT_EXPIRATION_SEC,
                context_id,
                return_payload: None,
            }
            .packed(),
        );

        request_prompt().map_err(|err| Error::from(ErrorType::OpenPromptError(err)))?;

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
