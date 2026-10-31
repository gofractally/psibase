#[derive(Debug, psibase_plugin::ErrorEnum, thiserror::Error)]
#[repr(u32)]
pub enum ErrorType {
    #[error("public key must be a PEM PUBLIC KEY")]
    InvalidPublicKey = 1,
    #[error("invalid account name: {0}")]
    InvalidAccount(String),
}
