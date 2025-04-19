use psibase::plugin_error;

plugin_error! {
    pub ErrorType
    QueryResponseParseError(msg: String) => "Query response parsing error: {msg}",
    KeyMismatch => "Reported key hash does not match your key provided",
    FailedToFindEvaluation => "Failed to find keys in your evaluation history",
    FailedToDecryptKey => "Failed to decrypt key",
    EncryptionFailed => "Failed to encrypt key",
    UserNotFound => "User not found",
    UserSettingNotFound => "User setting not found",
    InvalidAccountNumber => "Invalid account number",
    NoAsymmetricKey => "No asymmetric key found",
    UsersNotFound => "Users not found",
    GroupNotFound => "Group not found",
    NotLoggedIn => "Not logged in",
}
