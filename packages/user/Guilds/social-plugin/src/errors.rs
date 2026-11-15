#[derive(Debug, psibase_plugin::ErrorEnum, thiserror::Error)]
#[repr(u32)]
pub enum ErrorType {
    #[error("title must be 80 bytes or less")]
    TitleTooLong,
    #[error("thread name must be 1-10 characters: a-z, 0-9, and -")]
    BadThreadName,
}
