#[allow(warnings)]
mod bindings;
use bindings::*;

use accounts::plugin::api::get_current_user;
use auth_delegate::plugin::api::new_account;
use exports::workshop::plugin::{
    app::{File, Guest as App},
    development::Guest as Development,
    mail::Guest as Mail,
    registry::{AppMetadata, Guest as Registry},
};
use host::types::types::Error;
use psibase::MethodNumber;
use staged_tx::plugin::proposer::set_propose_latch;
use std::str::FromStr;

use crate::trust::*;

psibase::define_trust! {
    descriptions {
        Low => "",
        Medium => "
            - Create new apps
            - Configure app cache behavior
        ",
        High => "
            - Publish and manage app metadata
            - Upload and manage app assets and service code
        ",
    }
    functions {
        None => [],
        Low => [],
        Medium => [create_app, set_cache_mode],
        High => [set_app_metadata, publish_app, unpublish_app, upload, upload_tree, enable_spa, set_csp, delete_csp, remove, set_service_code],
        Max => [send, archive, save],
    }
}

struct WorkshopPlugin;

impl App for WorkshopPlugin {
    fn upload(app: String, file: File, compression_quality: u8) -> Result<(), Error> {
        assert_authorized(FunctionName::upload)?;
        set_propose_latch(Some(&app)).unwrap();
        sites::plugin::api::upload(&file, compression_quality)
    }

    fn upload_tree(app: String, files: Vec<File>, compression_quality: u8) -> Result<u16, Error> {
        assert_authorized(FunctionName::upload_tree)?;
        set_propose_latch(Some(&app)).unwrap();

        sites::plugin::api::upload_tree(&files, compression_quality)
    }

    fn enable_spa(app: String, enable: bool) -> Result<(), Error> {
        assert_authorized(FunctionName::enable_spa)?;
        set_propose_latch(Some(&app)).unwrap();

        sites::plugin::api::enable_spa(enable)
    }

    fn set_csp(app: String, path: String, csp: String) -> Result<(), Error> {
        assert_authorized(FunctionName::set_csp)?;
        set_propose_latch(Some(&app)).unwrap();
        sites::plugin::api::set_csp(&path, &csp)
    }

    fn set_cache_mode(app: String, enable: bool) -> Result<(), Error> {
        assert_authorized(FunctionName::set_cache_mode)?;
        set_propose_latch(Some(&app)).unwrap();
        sites::plugin::api::set_cache_mode(enable)
    }

    fn set_service_code(app: String, code: Vec<u8>) -> Result<(), Error> {
        assert_authorized(FunctionName::set_service_code)?;
        set_propose_latch(Some(&app)).unwrap();
        setcode::plugin::api::set_service_code(&app, &code);
        Ok(())
    }

    fn delete_csp(app: String, path: String) -> Result<(), Error> {
        assert_authorized(FunctionName::delete_csp)?;
        set_propose_latch(Some(&app)).unwrap();
        sites::plugin::api::delete_csp(&path)
    }

    fn remove(app: String, path: String) -> Result<(), Error> {
        assert_authorized(FunctionName::remove)?;
        set_propose_latch(Some(&app)).unwrap();
        sites::plugin::api::remove(&path)
    }
}

impl Mail for WorkshopPlugin {
    fn send(app: String, receiver: String, subject: String, body: String) -> Result<(), Error> {
        assert_authorized(FunctionName::send)?;
        set_propose_latch(Some(&app)).unwrap();
        chainmail::plugin::api::send(&receiver, &subject, &body)
    }

    fn archive(app: String, msg_id: u64) -> Result<(), Error> {
        assert_authorized(FunctionName::archive)?;
        set_propose_latch(Some(&app)).unwrap();
        chainmail::plugin::api::archive(msg_id)
    }

    fn save(app: String, msg_id: u64) -> Result<(), Error> {
        assert_authorized(FunctionName::save)?;
        set_propose_latch(Some(&app)).unwrap();
        chainmail::plugin::api::save(msg_id)
    }
}

impl Registry for WorkshopPlugin {
    fn create_app(app: String) -> Result<(), Error> {
        assert_authorized(FunctionName::create_app)?;
        new_account(&app, &get_current_user().unwrap())?;
        Ok(())
    }

    fn set_app_metadata(app: String, metadata: AppMetadata) {
        assert_authorized(FunctionName::set_app_metadata).unwrap();
        set_propose_latch(Some(&app)).unwrap();
        registry::plugin::developer::set_metadata(&metadata);
    }

    fn publish_app(app: String) {
        assert_authorized(FunctionName::publish_app).unwrap();
        set_propose_latch(Some(&app)).unwrap();
        registry::plugin::developer::publish();
    }

    fn unpublish_app(app: String) {
        assert_authorized(FunctionName::unpublish_app).unwrap();
        set_propose_latch(Some(&app)).unwrap();
        registry::plugin::developer::unpublish();
    }
}

impl Development for WorkshopPlugin {
    fn is_valid_method_name(name: String) -> bool {
        MethodNumber::from_str(&name).unwrap().to_string() == name
    }
}

bindings::export!(WorkshopPlugin with_types_in bindings);
