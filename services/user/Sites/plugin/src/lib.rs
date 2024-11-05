#[allow(warnings)]
mod bindings;

use bindings::exports::sites::plugin::sites::Guest as Sites;
use bindings::host::common::types::Error;
use bindings::sites::plugin::types::File;
use bindings::transact::plugin::intf as Transact;
use psibase::compress_content;
use psibase::fracpack::Pack;
use psibase::services::sites as SitesService;
use psibase::Hex;

mod errors;
use errors::ErrorType;
struct SitesPlugin;

const COMPRESSION_QUALITY: u32 = 11;

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

impl Sites for SitesPlugin {
    fn upload(file: File) -> Result<(), Error> {
        let (content, content_encoding) =
            compress_content(&file.content, &file.content_type, COMPRESSION_QUALITY);

        let packed = SitesService::action_structs::storeSys {
            path: file.path.clone(),
            contentType: file.content_type,
            contentEncoding: content_encoding,
            content: Hex::from(content),
        }
        .packed();

        if packed.len() >= TX_SIZE_LIMIT {
            return Err(ErrorType::FileTooLarge(&file.path).into());
        }

        Transact::add_action_to_transaction("storeSys", &packed)?;
        Ok(())
    }

    fn upload_tree(files: Vec<File>) -> Result<u16, Error> {
        let mut accumulated_size = 0;
        for (index, file) in files.iter().enumerate() {
            let (content, content_encoding) =
                compress_content(&file.content, &file.content_type, COMPRESSION_QUALITY);

            let packed = SitesService::action_structs::storeSys {
                path: normalize_path(&file.path),
                contentType: file.content_type.clone(),
                contentEncoding: content_encoding,
                content: Hex::from(content),
            }
            .packed();

            if index == 0 && packed.len() >= TX_SIZE_LIMIT {
                return Err(ErrorType::FileTooLarge(&file.path).into());
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
