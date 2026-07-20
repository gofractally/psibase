#[derive(Debug, psibase_plugin::ErrorEnum, thiserror::Error)]
#[repr(u32)]
pub enum ErrorType {
    #[error("[{0} -> {1}] - {2} - User must be logged in to perform this action")]
    LoggedInUserDNE(String, String, String),
    #[error(
        "[{0} -> {1}] - {2} - Only the active app (or 'allowed callers') can request permission."
    )]
    InvalidCaller(String, String, String),
}
