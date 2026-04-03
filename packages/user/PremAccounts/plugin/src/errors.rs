use psibase::plugin_error;

plugin_error! {
    pub ErrorType
    QueryResponseParseError(msg: String) => "Query response parsing error: {msg}",
    InvalidPublicKey(msg: String) => "Invalid public key: {msg}",
    AccountPurchaseFailed(msg: String) => "Account purchase failed: {msg}",
    SystemTokenNotDefined => "system token is not configured",
    MaxCostNotCanonicalDecimal => "max cost must be a canonical token decimal (exactly the network token precision, e.g. 1.0000 for precision 4)",
    MaxCostBelowCurrentAsk => "max cost is below the current price; increase max cost to at least the amount shown for this name length",
    ConfigMarketCallerDenied => "prem accounts admin actions may only be called from the config app",
    AddMarketCallerDenied => "add market may only be called from the config app",
    AddMarketLengthInvalid => "market name length is outside the allowed range for premium name markets",
    InvalidPremiumAccountName => "invalid premium account name: start with a letter; use only lowercase letters, numbers, and hyphens; allowed length and trailing rules apply; may not start with 'x-'",
    PremiumNameLengthNotOffered => "this name length is not offered as a premium account on this network",
    PremiumMarketDisabled => "premium names of this length cannot be purchased at the moment",
}
