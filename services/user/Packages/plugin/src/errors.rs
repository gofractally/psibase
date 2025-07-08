use psibase::plugin_error;

plugin_error! {
    pub ErrorType
    QueryError(msg: String) => "Graphql error: {msg}",
    PackageResolutionError(msg: String) => "{msg}",
    PackageFormatError(msg: String) => "{msg}",
    JsonError(msg: String) => "{msg}",
    NoLoggedInUser => "No logged in user",
}
