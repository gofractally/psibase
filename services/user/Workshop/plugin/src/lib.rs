#[allow(warnings)]
mod bindings;
use bindings::*;

mod db;
use db::user_table::UserTables;
use exports::workshop::plugin::{
    admin::Guest as Admin,
    app::{File, Guest as App},
    mail::Guest as Mail,
};
use host::common::types::Error;
use staged_tx::plugin::proposer::set_propose_latch;

mod errors;
use errors::ErrorType;

struct WorkshopPlugin;

impl Admin for WorkshopPlugin {
    fn add_managed(app: String) -> Result<(), Error> {
        let Some(user) = accounts::plugin::active_app::get_logged_in_user()? else {
            return Err(ErrorType::LoginRequired.into());
        };

        UserTables::new(&user).add_managed_app(&app);
        Ok(())
    }

    fn remove_managed(app: String) -> Result<(), Error> {
        let Some(user) = accounts::plugin::active_app::get_logged_in_user()? else {
            return Err(ErrorType::LoginRequired.into());
        };

        UserTables::new(&user).remove_managed_app(&app);
        Ok(())
    }

    fn get_all_managed() -> Vec<String> {
        let user = match accounts::plugin::active_app::get_logged_in_user() {
            Ok(Some(user)) => user,
            Ok(None) | Err(_) => return vec![],
        };

        UserTables::new(&user).get_managed_apps().apps
    }
}

impl App for WorkshopPlugin {
    fn upload(app: String, file: File, compression_quality: u8) -> Result<(), Error> {
        set_propose_latch(&app)?;
        sites::plugin::api::upload(&file, compression_quality)
    }

    fn upload_tree(app: String, files: Vec<File>, compression_quality: u8) -> Result<u16, Error> {
        set_propose_latch(&app)?;
        sites::plugin::api::upload_tree(&files, compression_quality)
    }

    fn enable_spa(app: String, enable: bool) -> Result<(), Error> {
        set_propose_latch(&app)?;
        sites::plugin::api::enable_spa(enable)
    }

    fn set_csp(app: String, path: String, csp: String) -> Result<(), Error> {
        set_propose_latch(&app)?;
        sites::plugin::api::set_csp(&path, &csp)
    }

    fn set_cache_mode(app: String, enable: bool) -> Result<(), Error> {
        set_propose_latch(&app)?;
        sites::plugin::api::set_cache_mode(enable)
    }

    fn set_service_code(app: String, code: Vec<u8>) -> Result<(), Error> {
        set_propose_latch(&app)?;
        setcode::plugin::api::set_service_code(&code);
        Ok(())
    }
}

impl Mail for WorkshopPlugin {
    fn send(app: String, receiver: String, subject: String, body: String) -> Result<(), Error> {
        set_propose_latch(&app)?;
        chainmail::plugin::api::send(&receiver, &subject, &body)
    }

    fn archive(app: String, msg_id: u64) -> Result<(), Error> {
        set_propose_latch(&app)?;
        chainmail::plugin::api::archive(msg_id)
    }

    fn save(app: String, msg_id: u64) -> Result<(), Error> {
        set_propose_latch(&app)?;
        chainmail::plugin::api::save(msg_id)
    }
}

bindings::export!(WorkshopPlugin with_types_in bindings);
