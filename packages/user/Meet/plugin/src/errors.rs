use psibase::plugin_error;

plugin_error! {
    pub ErrorType
    QueryResponseParseError(msg: String) => "Query response parsing error: {msg}",
    InvalidAccountNumber => "Invalid account number",
    NotLoggedIn => "Not logged in",
    NoAsymmetricKey => "No meeting identity key found",
    InvalidKeyLength => "Invalid key length",
    InvalidPrivateKey => "Invalid private key format",
    KeyDeserializationFailed => "Failed to deserialize key data",
    EncryptionFailed => "Failed to encrypt meeting key",
    DecryptionFailed => "Failed to decrypt meeting key",
    KeyMismatch => "Unwrapped meeting key does not match the published hash",
    WrapNotReady => "Your meeting key has not been published yet",
    UserKeyNotFound(account: String) => "No public meeting key registered for {account}",
    MeetingNotFound => "Meeting not found",
    NotAMember => "Not a member of this meeting",
}
