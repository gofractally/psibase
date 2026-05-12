#[derive(Debug, psibase_plugin::ErrorEnum, thiserror::Error)]
#[repr(u32)]
pub enum ErrorType {
    #[error("Query response parsing error: {0}")]
    QueryResponseParseError(String),
    #[error("Invalid account number")]
    InvalidAccountNumber,
}
