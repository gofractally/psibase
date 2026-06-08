#[derive(Debug, psibase_plugin::ErrorEnum, thiserror::Error)]
#[repr(u32)]
pub enum ErrorType {
    #[error("Query response parsing error: {0}")]
    QueryResponseParseError(String),
    #[error("System token not defined")]
    SystemTokenNotDefined,
    #[error("Max cost below current ask")]
    MaxCostBelowCurrentAsk,
    #[error("Invalid account name: {0}")]
    InvalidAccountName(String),
    #[error("Premium name length not offered")]
    PremiumNameLengthNotOffered,
    #[error("Premium name market disabled")]
    PremiumNameMarketDisabled,
}
