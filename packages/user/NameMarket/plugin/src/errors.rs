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
    #[error("Account names of this length are not currently available")]
    NameLengthUnavailable,
    #[error("Increase and decrease percent must be greater than 0")]
    InvalidAdjustPct,
    #[error("initial_price is required when creating a name market for length {0}")]
    InitialPriceRequired(u8),
}
