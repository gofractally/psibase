use psibase::plugin_error;

plugin_error! {
    pub ErrorType
    QueryResponseParseError(msg: String) => "Query response parsing error: {msg}",
    PermissionsDialogAsyncNotYetAvailable() => "Permissions dialog will fail until WASM async is implemented. Respond to dialog and repeat action to continue.",
    RequestRedirect(id: String) => "Request Redirect: id={id}",
    InvalidRequester() => "Disallowed third-party requester while saving permission",
    PermissionRequestFailure() => "Failed while authorizing a permission request",
    SerderError(msg: String) => "(de)serialization error: {msg}"
}
