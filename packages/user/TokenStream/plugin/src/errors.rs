use psibase::plugin_error;

plugin_error! {
    pub ErrorType
    QueryResponseParseError(msg: String) => "Query response parsing error: {msg}",
    NotImplemented(msg: String) => "Feature not implemented: {msg}",
}
