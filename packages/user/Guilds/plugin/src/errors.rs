#[derive(Debug, psibase_plugin::ErrorEnum, thiserror::Error)]
#[repr(u32)]
pub enum ErrorType {
    #[error("Query response parsing error: {0}")]
    QueryResponseParseError(String),
    #[error("No pending evaluation for guild")]
    NoPendingEvaluation,
    #[error("Invalid account number")]
    InvalidAccountNumber,
}
