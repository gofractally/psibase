/// A service that offers server-side Brotli decompression
#[psibase::service]
mod service {
    use psibase::services::brotli_codec::brotli_impl;

    /// Decompresses a Brotli-compressed byte array
    #[action]
    fn decompress(content: Vec<u8>) -> Vec<u8> {
        brotli_impl::decompress(content)
    }

    // Compression currently unsupported
    // #[action]
    // fn compress(content: Vec<u8>, quality: u8) -> Vec<u8> {
    //     brotli_impl::compress(content, quality)
    // }
}

#[cfg(test)]
mod tests {
    use crate::Wrapper;
    use anyhow::anyhow;
    use base64::{engine::general_purpose::URL_SAFE, Engine};

    const UNCOMPRESSED_STRING: &str = "Hello, world!!";
    const COMPRESSED_STRING: &str = "iwaASGVsbG8sIHdvcmxkISED";

    // #[psibase::test_case(packages("BrotliCodec"))]
    // fn test_compression(chain: psibase::Chain) -> Result<(), psibase::Error> {
    //     let content = String::from(UNCOMPRESSED_STRING).into_bytes();
    //     let compressed = Wrapper::push(&chain)
    //         .compress(content, 11)
    //         .get()
    //         .map_err(|e| anyhow!("{}", format!("[Test] Brotli compression failed: {:?}", e)))?;

    //     let compressed_b64 = URL_SAFE.encode(&compressed);

    //     assert_eq!(compressed_b64, COMPRESSED_STRING);

    //     Ok(())
    // }

    #[psibase::test_case(packages("BrotliCodec"))]
    fn test_decompression(chain: psibase::Chain) -> Result<(), psibase::Error> {
        let compressed_bytes: Vec<u8> = URL_SAFE.decode(COMPRESSED_STRING).unwrap();

        let uncompressed = Wrapper::push(&chain)
            .decompress(compressed_bytes)
            .get()
            .map_err(|e| anyhow!("{}", format!("[Test] Brotli decompression failed: {:?}", e)))?;

        let uncompressed_str = String::from_utf8(uncompressed)
            .map_err(|_| anyhow!("Decompressed string is not valid UTF-8"))?;

        assert_eq!(uncompressed_str, UNCOMPRESSED_STRING);

        Ok(())
    }
}
