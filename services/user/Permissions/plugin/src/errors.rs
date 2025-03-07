use psibase::plugin_error;

// const NOT_EXACTLY_MAX_INT: u32 = 999999999;

plugin_error! {
    pub ErrorType
    QueryResponseParseError(msg: String) => "Query response parsing error: {msg}",
    PermissionsDialogAsyncNotYetAvailable() => "Permissions dialog will fail until WASM async is implemented. Respond to dialog and repeat action to continue.",
    RequestRedirect(id: String) = 999999999 => "{{ \"id\": \"{id}\" }}",
    InvalidRequester() => "Disallowed third-party requester while saving permission",
    SerderError(msg: String) => "(de)serialization error: {msg}"
}
