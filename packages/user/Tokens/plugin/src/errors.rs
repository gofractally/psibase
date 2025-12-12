use psibase::plugin_error;

plugin_error! {
    pub ErrorType
    ConversionError(msg: String) = 500 => "Conversion error: {msg}",
    QueryError(msg: String) => "Query error {msg}",
    TokenMismatch(msg: String) => "Token does not exist: {msg}",
}
