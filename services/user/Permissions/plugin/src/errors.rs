use psibase::plugin_error;

plugin_error! {
    pub ErrorType
    QueryResponseParseError(msg: String) => "Query response parsing error: {msg}",
    InvalidRequester() => "Disallowed third-party requester while saving permission",
    LoggedInUserDNE() => "User must be logged in to perform this action",
}
