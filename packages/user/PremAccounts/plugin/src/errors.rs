#[derive(Debug, psibase_plugin::ErrorEnum, thiserror::Error)]
#[repr(u32)]
pub enum ErrorType {
    #[error("Query response parsing error: {0}")]
    QueryResponseParseError(String),
    #[error("System token not defined")]
    SystemTokenNotDefined,
    #[error("Max cost not canonical decimal")]
    MaxCostNotCanonicalDecimal,
    #[error("Max cost below current ask")]
    MaxCostBelowCurrentAsk,
    #[error("Create market length invalid")]
    CreateMarketLengthInvalid,
    #[error("Invalid premium account name")]
    InvalidPremiumAccountName,
    #[error("Premium name length not offered")]
    PremiumNameLengthNotOffered,
    #[error("Premium name market disabled")]
    PremiumNameMarketDisabled,
}
