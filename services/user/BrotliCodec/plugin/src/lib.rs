#[allow(warnings)]
mod bindings;
mod errors;
use errors::ErrorType::*;

use bindings::exports::brotli_codec::plugin::api::{Error, Guest as API};
use psibase::services::brotli_codec::brotli_impl;

struct BrotliPlugin;

impl API for BrotliPlugin {
    fn compress(content: Vec<u8>, quality: u8) -> Result<Vec<u8>, Error> {
        if quality < 1 || quality > 11 {
            return Err(InvalidQuality(quality).into());
        }
        Ok(brotli_impl::compress(content, quality))
    }

    fn decompress(content: Vec<u8>) -> Vec<u8> {
        brotli_impl::decompress(content)
    }
}

bindings::export!(BrotliPlugin with_types_in bindings);
