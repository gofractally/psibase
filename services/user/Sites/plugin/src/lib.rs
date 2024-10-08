#[allow(warnings)]
mod bindings;

use bindings::exports::sites::plugin::sites::Guest as Sites;
use bindings::host::common::types::Error;
use bindings::sites::plugin::types::File;
use bindings::transact::plugin::intf as Transact;
use psibase::fracpack::Pack;
use psibase::services::sites as SitesService;
use psibase::Hex;

mod errors;
use errors::ErrorType;

use std::io::Write;

struct SitesPlugin;

const COMPRESSION_QUALITY: u32 = 4;

// Add a leading slash if missing and remove trailing slashes.
fn normalize_path(path: &String) -> String {
    let mut result = String::new();
    if !path.starts_with('/') {
        result.push('/');
    }
    result.push_str(path);
    while result.ends_with('/') {
        result.pop();
    }
    result
}

const TX_SIZE_LIMIT: usize = 64 * 1024; // 64kb

fn should_compress(content_type: &str) -> bool {
    matches!(
        content_type,
        "text/plain"
            | "text/html"
            | "text/css"
            | "application/javascript"
            | "application/json"
            | "application/xml"
            | "application/rss+xml"
            | "application/atom+xml"
            | "image/svg+xml"
            | "font/ttf"
            | "font/otf"
            | "application/wasm"
    )
}

fn compress_content(content: &[u8], content_type: &str) -> (Vec<u8>, Option<String>) {
    if should_compress(content_type) {
        let mut writer = brotli::CompressorWriter::new(Vec::new(), 4096, COMPRESSION_QUALITY, 22);
        writer.write_all(content).unwrap();
        (writer.into_inner(), Some("br".to_string()))
    } else {
        (content.to_vec(), None)
    }
}

impl Sites for SitesPlugin {
    fn upload(file: File) -> Result<(), Error> {
        let (content, content_encoding) = compress_content(&file.content, &file.content_type);

        let packed = SitesService::action_structs::storeSys {
            path: file.path.clone(),
            contentType: file.content_type,
            contentEncoding: content_encoding,
            content: Hex::from(content),
        }
        .packed();

        if packed.len() >= TX_SIZE_LIMIT {
            return Err(ErrorType::FileTooLarge.err(&file.path));
        }

        Transact::add_action_to_transaction("storeSys", &packed)?;
        Ok(())
    }

    fn upload_tree(files: Vec<File>) -> Result<u16, Error> {
        let mut accumulated_size = 0;
        for (index, file) in files.iter().enumerate() {
            let (content, content_encoding) = compress_content(&file.content, &file.content_type);

            let packed = SitesService::action_structs::storeSys {
                path: normalize_path(&file.path),
                contentType: file.content_type.clone(),
                contentEncoding: content_encoding,
                content: Hex::from(content),
            }
            .packed();

            if index == 0 && packed.len() >= TX_SIZE_LIMIT {
                return Err(ErrorType::FileTooLarge.err(&file.path));
            }

            accumulated_size += packed.len();
            if accumulated_size >= TX_SIZE_LIMIT {
                return Ok(index as u16);
            }

            Transact::add_action_to_transaction("storeSys", &packed)?;
        }

        Ok(0)
    }

    fn enable_spa(enable: bool) -> Result<(), Error> {
        Transact::add_action_to_transaction(
            "enableSpa",
            &SitesService::action_structs::enableSpa { enable }.packed(),
        )?;
        Ok(())
    }

    fn set_csp(path: String, csp: String) -> Result<(), Error> {
        Transact::add_action_to_transaction(
            "setCsp",
            &SitesService::action_structs::setCsp { path, csp }.packed(),
        )?;
        Ok(())
    }

    fn enable_cache(enable: bool) -> Result<(), Error> {
        Transact::add_action_to_transaction(
            "enableCache",
            &SitesService::action_structs::enableCache { enable }.packed(),
        )?;
        Ok(())
    }
}

bindings::export!(SitesPlugin with_types_in bindings);
