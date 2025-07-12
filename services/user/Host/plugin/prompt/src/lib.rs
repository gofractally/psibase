#[allow(warnings)]
mod bindings;
use bindings::*;

mod errors;
use errors::ErrorType;

use exports::host::prompt::{api::Guest as Api, web::Guest as Web};
use host::common::client::{get_app_url, get_sender_app};
use host::common::types::{Error, PluginId};
use psibase::fracpack::{Pack, Unpack};

use chrono::Utc;
use clientdata::plugin::keyvalue as KeyValue;
use rand::Rng;

struct HostPrompt;

#[derive(Pack, Unpack)]
struct ActivePrompt {
    id: u32,
    subdomain: String,
    subpath: String,
    expiry_timestamp: u32,
}

const PROMPT_EXPIRATION_SEC: u32 = 2 * 60;
const ACTIVE_PROMPT_REQ: &str = "active_prompt_request";
const REDIRECT_ERROR_CODE: u32 = 999999999;

// TODO: ensure this can only be called by the host plugin
impl Api for HostPrompt {
    fn get_active_prompt(id: u32, return_path: String) -> Result<String, Error> {
        assert_eq!(get_sender_app().app.unwrap(), "host", "Unauthorized");

        let val = KeyValue::get(ACTIVE_PROMPT_REQ).ok_or(ErrorType::NoActivePrompt())?;
        let details = <ActivePrompt>::unpacked(&val).unwrap();

        if id != details.id {
            return Err(ErrorType::PromptNotFound(id).into());
        }

        if Utc::now().timestamp() as u32 >= details.expiry_timestamp {
            KeyValue::delete(ACTIVE_PROMPT_REQ);
            return Err(ErrorType::PromptExpired(id).into());
        }

        let url = format!(
            "{}/{}?id={}&returnUrlPath={}",
            get_app_url(&details.subdomain).trim_end_matches('/'),
            details.subpath.trim_start_matches('/'),
            id,
            urlencoding::encode(&return_path)
        );

        Ok(url)
    }
}

fn validate_subpath(subpath: &str) -> Result<(), Error> {
    // Some extra minor validation to help catch a natural mistake
    if subpath.starts_with("http://") || subpath.starts_with("https://") {
        return Err(ErrorType::InvalidSubpath().into());
    }

    Ok(())
}

impl Web for HostPrompt {
    fn prompt_user(subpath: Option<String>, _payload_json: Option<String>) -> Result<(), Error> {
        let mut subpath = subpath.unwrap_or("/".to_string());
        validate_subpath(&subpath)?;

        if subpath.contains("?") {
            println!("[Warning]: Query params stripped from requested prompt subpath.");
            subpath = subpath.split('?').next().unwrap().to_string();
        }

        // Store the active prompt in the host's namespace
        let id: u32 = rand::rng().random();
        KeyValue::set(
            ACTIVE_PROMPT_REQ,
            &ActivePrompt {
                id,
                subdomain: get_sender_app().app.unwrap(),
                subpath: subpath.clone(),
                expiry_timestamp: Utc::now().timestamp() as u32 + PROMPT_EXPIRATION_SEC,
            }
            .packed(),
        );

        // In old code, here we added the id and the current user to the object stored
        //    in the app's namespace:
        // let current_user = get_current_user().expect("No currently logged-in user");
        // Obj = _appPayload + id + current_user
        // KeyValue::set_foreign(caller(), ACTIVE_PROMPT_REQ, Obj)

        let redirect_url = get_app_url("host");
        let redirect_url = format!("{}/oauth.html?id={}", redirect_url, id);

        return Err(Error {
            code: REDIRECT_ERROR_CODE,
            producer: PluginId {
                service: "host".to_string(),
                plugin: "common".to_string(),
            },
            message: redirect_url,
        });
    }
}

bindings::export!(HostPrompt with_types_in bindings);
