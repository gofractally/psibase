use psibase::plugin_error;

plugin_error! {
    pub ErrorType
    QueryResponseParseError(msg: String) => "Query response parsing error: {msg}",
    InvalidPublicKey(msg: String) => "Invalid public key: {msg}",
    AccountPurchaseFailed(msg: String) => "Account purchase failed: {msg}",
    UpdateMarketStatusCallerDenied => "update market status may only be called from the config app",
}
