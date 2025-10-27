#[allow(warnings)]
mod bindings;

use bindings::exports::sites::plugin::api::Guest as Sites;
use bindings::host::types::types::Error;
use bindings::sites::plugin::types::File;
use bindings::transact::plugin::intf as Transact;
use psibase::compress_content;
use psibase::fracpack::Pack;
use psibase::services::sites::action_structs as Actions;
use psibase::Hex;

mod errors;
use errors::ErrorType;
struct SitesPlugin;

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

const TX_SIZE_LIMIT: usize = 3 * 1024 * 1024; // 3mb

fn validate_compression_quality(quality: u8) -> Result<(), Error> {
    if quality > 11 {
        return Err(ErrorType::InvalidCompressionQuality(quality).into());
    }
    Ok(())
}

impl Sites for SitesPlugin {
    fn upload(file: File, compression_quality: u8) -> Result<(), Error> {
        validate_compression_quality(compression_quality)?;

        let (content, content_encoding) = if compression_quality > 0 {
            compress_content(
                &file.content,
                &file.content_type,
                compression_quality as u32,
            )
        } else {
            (file.content, None)
        };

        let packed = Actions::storeSys {
            path: file.path.clone(),
            contentType: file.content_type,
            contentEncoding: content_encoding,
            content: Hex::from(content),
        }
        .packed();

        if packed.len() >= TX_SIZE_LIMIT {
            return Err(ErrorType::FileTooLarge(&file.path).into());
        }

        Transact::add_action_to_transaction("storeSys", &packed)
    }

    fn upload_encoded(file: File, content_encoding: String) -> Result<(), Error> {
        let packed = Actions::storeSys {
            path: file.path.clone(),
            contentType: file.content_type,
            contentEncoding: Some(content_encoding),
            content: Hex::from(file.content),
        }
        .packed();

        if packed.len() >= TX_SIZE_LIMIT {
            return Err(ErrorType::FileTooLarge(&file.path).into());
        }

        Transact::add_action_to_transaction("storeSys", &packed)
    }

    fn upload_tree(files: Vec<File>, compression_quality: u8) -> Result<u16, Error> {
        validate_compression_quality(compression_quality)?;

        let mut accumulated_size = 0;
        for (index, file) in files.into_iter().enumerate() {
            let (content, content_encoding) = if compression_quality > 0 {
                compress_content(
                    &file.content,
                    &file.content_type,
                    compression_quality as u32,
                )
            } else {
                (file.content, None)
            };

            let packed = Actions::storeSys {
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

    fn remove(path: String) -> Result<(), Error> {
        Transact::add_action_to_transaction("remove", &Actions::remove { path }.packed())
    }

    fn enable_spa(enable: bool) -> Result<(), Error> {
        Transact::add_action_to_transaction("enableSpa", &Actions::enableSpa { enable }.packed())
    }

    fn set_csp(path: String, csp: String) -> Result<(), Error> {
        Transact::add_action_to_transaction("setCsp", &Actions::setCsp { path, csp }.packed())
    }

    fn set_cache_mode(enable: bool) -> Result<(), Error> {
        Transact::add_action_to_transaction(
            "enableCache",
            &Actions::enableCache { enable }.packed(),
        )
    }

    fn delete_csp(path: String) -> Result<(), Error> {
        Transact::add_action_to_transaction("deleteCsp", &Actions::deleteCsp { path }.packed())
    }

    fn set_proxy(proxy: String) {
        let proxy = psibase::AccountNumber::from(proxy.as_str());
        Transact::add_action_to_transaction("setProxy", &Actions::setProxy { proxy }.packed())
            .unwrap();
    }

    fn clear_proxy() {
        Transact::add_action_to_transaction("clearProxy", &Actions::clearProxy {}.packed())
            .unwrap();
    }
}

bindings::export!(SitesPlugin with_types_in bindings);
