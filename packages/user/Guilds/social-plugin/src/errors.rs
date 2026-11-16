#[derive(Debug, psibase_plugin::ErrorEnum, thiserror::Error)]
#[repr(u32)]
pub enum ErrorType {
    #[error("title must be 80 bytes or less")]
    TitleTooLong,
    #[error("description must be 80 bytes or less")]
    DescriptionTooLong,
    #[error("subject must be 80 bytes or less")]
    SubjectTooLong,
    #[error("thread name must be 1-10 characters: a-z, 0-9, and -")]
    BadThreadName,
}
