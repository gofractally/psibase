use psibase::plugin_error;

plugin_error! {
    pub ErrorType
    QueryResponseParseError(msg: String) => "Query response parsing error: {msg}",
    QueryError(msg: String) => "Query error {msg}",
    TokenMismatch(msg: String) => "Token does not exist: {msg}"
}
