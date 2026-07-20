#[derive(Debug, psibase_plugin::ErrorEnum, thiserror::Error)]
#[repr(u32)]
pub enum ErrorType {
    #[error("Invalid account number: {0}")]
    InvalidAccountNumber(String),
}
