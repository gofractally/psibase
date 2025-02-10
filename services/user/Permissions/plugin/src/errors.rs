use psibase::plugin_error;

plugin_error! {
    pub ErrorType
    QueryResponseParseError(msg: String) => "Query response parsing error: {msg}",
    PermissionsDialogAsyncNotYetAvailable() => "Permissions dialog will fail until WASM async is implemented. Respond to dialog and repeat action to continue.",
    InvalidRequester() => "Disallowed third-party requester while saving permission",
}
