use psibase::plugin_error;

plugin_error! {
    pub ErrorType
    QueryError(msg: String) => "Query error {msg}",
}
