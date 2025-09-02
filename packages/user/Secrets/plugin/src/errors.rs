use psibase::plugin_error;

plugin_error! {
    pub ErrorType
    QueryResponseParseError(msg: String) => "Query response parsing error: {msg}",
    InvalidSecretFormat => "Invalid secret format in response",
}
