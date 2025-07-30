use psibase::plugin_error;

plugin_error! {
    pub ErrorType
    NotImplemented(msg: String) => "Feature not implemented: {msg}",
    QueryError(msg: String) => "Query error {msg}",
    TokenMismatch(msg: String) => "Token does not exist: {msg}",
    InvalidTokenId(msg: String) => "Invalid token ID: {msg}",
}
