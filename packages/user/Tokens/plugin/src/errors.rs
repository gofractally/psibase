use psibase::plugin_error;

plugin_error! {
    pub ErrorType
    AmountIsZero = 1 => "Amount is zero",
    ConversionError(msg: String) => "Conversion error: {msg}",
    QueryError(msg: String) => "Query error {msg}",
    TokenMismatch(msg: String) => "Token does not exist: {msg}",
}
