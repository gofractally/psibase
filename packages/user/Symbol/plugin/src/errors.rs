use psibase::plugin_error;

plugin_error! {
    pub ErrorType
    QueryResponseParseError(msg: String) => "Query response parsing error: {msg}",
    BillingTokenNotSet => "Billing token has not been configured",
    SymbolDoesNotExist => "Symbol does not exist"
}
