use psibase::plugin_error;

plugin_error! {
    pub ErrorType
    QueryResponseParseError(msg: String) => "Query response parsing errorrrr: {msg}",
    QueryError(msg: String) => "Query errorrrr {msg}",
    TokenMismatch(msg: String) => "Token does not exist: {msg}"
}
