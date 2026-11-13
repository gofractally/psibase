#[derive(Debug, psibase_plugin::ErrorEnum, thiserror::Error)]
#[repr(u32)]
pub enum ErrorType<'a> {
    #[error("Unauthorized: {0}")]
    Unauthorized(&'a str),
    #[error("JSON decode error: {0}")]
    JsonDecodeError(String),
    #[error("Invalid account name: {0}")]
    InvalidAccountName(&'a str),
    #[error("Key cannot authorize account: {0}")]
    AuthorizationFailed(&'a str),
}
