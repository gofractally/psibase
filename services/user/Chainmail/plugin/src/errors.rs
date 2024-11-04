use psibase::plugin_error;

plugin_error! {
    #[derive(Debug)]
    pub ErrorType
    QueryResponseParseError(msg: String) => "Query response parsing error: {msg}",
}
