use psibase::plugin_error;

plugin_error! {
    pub ErrorType
    QueryError(msg: String) => "Query error {msg}",
    NetworkTokenNotFound => "Network token not found",
    NotLoggedIn => "No user logged in",
    ConversionError(msg: String) => "Conversion error: {msg}",
    Overflow => "Percentage to PPM overflow",
}
