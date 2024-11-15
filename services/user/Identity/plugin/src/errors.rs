use psibase::plugin_error;

plugin_error! {
    pub ErrorType
    InvalidClaim(score: f32) => "Invalid Confidence (must be between 0.0 and 1.0): {score}",
    QueryResponseParseError(msg: String) => "Query response parsing error: {msg}",
}
