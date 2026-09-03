impl From<psibase_plugin::Error> for ImportExistingError {
    fn from(error: psibase_plugin::Error) -> Self {
        Self(vec![(String::new(), error)])
    }
}

#[derive(Debug, psibase_plugin::ErrorEnum, thiserror::Error)]
#[repr(u32)]
pub enum ErrorTypes {
    #[error("Invalid account name: {0}")]
    InvalidAccountName(String),
    #[error("Graphql query error: {0}")]
    QueryError(String),
    #[error("Cannot create account")]
    CannotCreateAccount,
    #[error("Account not found: {0}")]
    AccountNotFound(String),
    #[error("Account uses unsupported auth service: {0}")]
    UnsupportedAuthService(String),
    #[error("Key cannot authorize account: {0}")]
    AuthorizationFailed(String),
}
