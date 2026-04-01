use psibase::plugin_error;

plugin_error! {
    pub ErrorType
    QueryResponseParseError(msg: String) => "Query response parsing error: {msg}",
    InvalidPublicKey(msg: String) => "Invalid public key: {msg}",
    AccountPurchaseFailed(msg: String) => "Account purchase failed: {msg}",
    SystemTokenNotDefined => "system token is not configured",
    MaxCostNotCanonicalDecimal => "max cost must be a canonical token decimal (exactly the network token precision, e.g. 1.0000 for precision 4)",
    UpdateMarketStatusCallerDenied => "update market status may only be called from the config app",
    AddMarketCallerDenied => "add market may only be called from the config app",
    AddMarketLengthInvalid => "market name length must be between 1 and 15",
}
