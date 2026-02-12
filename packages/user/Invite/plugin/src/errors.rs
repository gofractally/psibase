#[derive(Debug, psibase_plugin::ErrorEnum, thiserror::Error)]
#[repr(u32)]
pub enum ErrorTypes {
    #[error("Graphql error: {0}")]
    QueryError(String),
    #[error("Error: Invite is no longer valid or expired")]
    InviteNotValid = 4,
}
