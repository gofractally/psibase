use psibase::plugin_error;

plugin_error! {
    pub ErrorType
    QueryResponseParseError(msg: String) => "Query response parsing error: {msg}",
    PermissionsSaveError() => "Error saving permissions",
    InvalidRequester() => "Disallowed third-party requester while saving permission",
    NotYetImplemented() => "Not yet implemented",
}
