use psibase::plugin_error;

plugin_error! {
    pub ErrorType
    KeyMismatch => "Reported key hash does not match your key provided",
    FailedToFindEvaluation => "Failed to find keys in your evaluation history",
    FailedToDecryptKey => "Failed to decrypt key",
    DecryptionFailed => "Failed to decrypt",
    EncryptionFailed => "Failed to encrypt",
    UserNotFound => "User not found",
    UserSettingNotFound => "User setting not found",
    EvaluationNotFound => "Evaluation not found",
    InvalidAccountNumber => "Invalid account number",
    NoAsymmetricKey => "No asymmetric key found",
    UsersNotFound => "Users not found",
    GroupNotFound => "Group not found",
    NotLoggedIn => "Not logged in",
    InvalidProposal => "Invalid proposal",
    KeyDeserializationFailed => "Failed to deserialize key data",
    InvalidKeyLength => "Invalid key length",
    DuplicateElement => "Duplicate element found in proposal during attestation",
    MissingKeySubmitter => "Key submitter not found",
    GraphQLParseError(msg: String) => "GraphQL parsing error: {msg}",
    TransactionFailed(msg: String) => "Transaction failed: {msg}",
    UserSubmissionNotFound => "User submission not found"
}
