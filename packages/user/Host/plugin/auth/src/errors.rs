use psibase::plugin_error;

plugin_error! {
    pub ErrorType
    ReauthorizationRequired(account: String) => "Account '{account}' needs to be reconnected",
}
