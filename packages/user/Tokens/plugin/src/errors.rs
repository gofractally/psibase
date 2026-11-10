#[derive(Debug, psibase_plugin::ErrorEnum, thiserror::Error)]
#[repr(u32)]
pub enum ErrorType {
    #[error("Amount is zero")]
    AmountIsZero = 1,
    #[error("Conversion error: {0}")]
    ConversionError(String),
    #[error("Query error {0}")]
    QueryError(String),
    #[error("Token does not exist: {0}")]
    TokenMismatch(String),
    #[error("Icon exceeds max size of {0} bytes")]
    IconTooBig(usize),
    #[error("Icon content type not allowed: {0}. Use PNG, JPEG, or WebP")]
    InvalidIconContentType(String),
}
