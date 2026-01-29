use psibase::plugin_error;

plugin_error! {
    pub ErrorType
    QueryResponseParseError(msg: String) => "Query response parsing error: {msg}",
    InvalidPublicKey(msg: String) => "Invalid public key: {msg}",
    AccountPurchaseFailed(msg: String) => "Account purchase failed: {msg}",
}
