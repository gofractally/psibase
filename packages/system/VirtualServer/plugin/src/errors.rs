#[derive(Debug, psibase::PluginError, thiserror::Error)]
#[repr(u32)]
pub enum ErrorType {
    #[error("Network token not found")]
    NetworkTokenNotFound,
    #[error("No user logged in")]
    NotLoggedIn,
    #[error("Conversion error: {0}")]
    ConversionError(String),
    #[error("Percentage to PPM overflow")]
    Overflow,
}
