use psibase::plugin_error;

plugin_error! {
    pub ErrorType
    QueryResponseParseError(msg: String) => "Query response parsing error: {msg}",
    NoPendingEvaluation => "No pending evaluation for guild",
    InvalidAccountNumber => "Invalid account number",
}
