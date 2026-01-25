use psibase::plugin_error;

plugin_error! {
    pub ErrorType
    TokenDoesNotExist => "Token does not exist in pool",
    QueryResponseParseError(msg: String) => "Query response parsing error: {msg}",
    QueryError(msg: String) => "Query error: {msg}",
    InvalidFormat(msg: String) => "Invalid format: {msg}",
    SlippageTooHigh(slippage: u32) => "Slippage must be in ppm format: received {slippage}, must be between 0 - 1,000,000",
    NoPathFound => "Failed to find pools to fulfil trade of these tokens",
    InsufficientPools => "Pools vector is empty",
    InsufficientLiquidity => "Insufficient liquidity to perform trade",
    DesiredHigherThanReserve => "Desired amount is higher than reserve balance"
}
