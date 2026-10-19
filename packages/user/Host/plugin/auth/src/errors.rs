use psibase::plugin_error;

plugin_error! {
    pub ErrorType
    MissingQueryToken(user: String, app: String) => "No query token cached for {user} on {app}; one must be provided",
}
