// External implementations are linked to from both the service and the plugin
pub mod brotli_impl {
    use std::io::Cursor;
    pub fn decompress(content: Vec<u8>) -> Vec<u8> {
        let mut cursor = Cursor::new(content);
        let mut decompressed = Vec::<u8>::new();
        brotli::BrotliDecompress(&mut cursor, &mut decompressed).expect("Decompression failed");
        decompressed
    }

    pub fn compress(content: Vec<u8>, quality: u8) -> Vec<u8> {
        let mut cursor = Cursor::new(content);
        let mut compressed = Vec::<u8>::new();
        let mut params = brotli::enc::BrotliEncoderParams::default();
        params.quality = quality as i32;
        let _ = brotli::BrotliCompress(&mut cursor, &mut compressed, &params)
            .expect("Compression failed");
        compressed
    }
}

/// A service that offers server-side Brotli decompression
#[crate::service(name = "brotli-codec", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
mod service {
    /// Decompresses a Brotli-compressed byte array
    #[action]
    fn decompress(content: Vec<u8>) -> Vec<u8> {
        unimplemented!()
    }

    // Compression currently unsupported
    // #[action]
    // fn compress(content: Vec<u8>, quality: u8) -> Vec<u8> {
    //     unimplemented!()
    // }
}
