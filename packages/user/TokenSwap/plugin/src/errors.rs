use psibase::plugin_error;

plugin_error! {
    pub ErrorType
    QueryResponseParseError(msg: String) => "Query response parsing error: {msg}",
    QueryError(msg: String) => "Query error: {msg}",
    SlippageTooHigh(slippage: u32) => "Slippage must be in ppm format: received {slippage}, must be between 0 - 1,000,000"

}
