#[allow(warnings)]
mod bindings;
use bindings::*;

use exports::workshop::plugin::{
    app::{File, Guest as App},
    mail::Guest as Mail,
    registry::{AppMetadata, Guest as Registry},
};
use host::common::types::Error;
use staged_tx::plugin::proposer::set_propose_latch;

struct ProposeLatch;

impl ProposeLatch {
    fn new(app: &str) -> Self {
        set_propose_latch(Some(app)).unwrap();
        Self
    }
}

impl Drop for ProposeLatch {
    fn drop(&mut self) {
        set_propose_latch(None).unwrap();
    }
}

struct WorkshopPlugin;

impl App for WorkshopPlugin {
    fn upload(app: String, file: File, compression_quality: u8) -> Result<(), Error> {
        let _latch = ProposeLatch::new(&app);

        sites::plugin::api::upload(&file, compression_quality)
    }

    fn upload_tree(app: String, files: Vec<File>, compression_quality: u8) -> Result<u16, Error> {
        let _latch = ProposeLatch::new(&app);

        sites::plugin::api::upload_tree(&files, compression_quality)
    }

    fn enable_spa(app: String, enable: bool) -> Result<(), Error> {
        let _latch = ProposeLatch::new(&app);

        sites::plugin::api::enable_spa(enable)
    }

    fn set_csp(app: String, path: String, csp: String) -> Result<(), Error> {
        let _latch = ProposeLatch::new(&app);
        sites::plugin::api::set_csp(&path, &csp)
    }

    fn set_cache_mode(app: String, enable: bool) -> Result<(), Error> {
        let _latch = ProposeLatch::new(&app);
        sites::plugin::api::set_cache_mode(enable)
    }

    fn set_service_code(app: String, code: Vec<u8>) -> Result<(), Error> {
        let _latch = ProposeLatch::new(&app);
        setcode::plugin::api::set_service_code(&app, &code);
        Ok(())
    }

    fn delete_csp(app: String, path: String) -> Result<(), Error> {
        let _latch = ProposeLatch::new(&app);
        sites::plugin::api::delete_csp(&path)
    }

    fn remove(app: String, path: String) -> Result<(), Error> {
        let _latch = ProposeLatch::new(&app);
        sites::plugin::api::remove(&path)
    }
}

impl Mail for WorkshopPlugin {
    fn send(app: String, receiver: String, subject: String, body: String) -> Result<(), Error> {
        let _latch = ProposeLatch::new(&app);
        chainmail::plugin::api::send(&receiver, &subject, &body)
    }

    fn archive(app: String, msg_id: u64) -> Result<(), Error> {
        let _latch = ProposeLatch::new(&app);
        chainmail::plugin::api::archive(msg_id)
    }

    fn save(app: String, msg_id: u64) -> Result<(), Error> {
        let _latch = ProposeLatch::new(&app);
        chainmail::plugin::api::save(msg_id)
    }
}

impl Registry for WorkshopPlugin {
    fn create_app(app: String) -> Result<(), Error> {
        registry::plugin::developer::create_app(&app)
    }

    fn set_app_metadata(app: String, metadata: AppMetadata) -> Result<(), Error> {
        let _latch = ProposeLatch::new(&app);
        registry::plugin::developer::set_app_metadata(&metadata)
    }

    fn publish_app(app: String) -> Result<(), Error> {
        let _latch = ProposeLatch::new(&app);
        registry::plugin::developer::publish_app(&app)
    }

    fn unpublish_app(app: String) -> Result<(), Error> {
        let _latch = ProposeLatch::new(&app);
        registry::plugin::developer::unpublish_app(&app)
    }
}

bindings::export!(WorkshopPlugin with_types_in bindings);
