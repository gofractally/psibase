use psibase::plugin_error;

plugin_error! {
    pub ErrorType
    CannotCreateAccount() => "Cannot create account",
    AccountNotFound(account: String) => "Account not found: {account}",
    UnsupportedAuthService(service: String) => "Account uses unsupported auth service: {service}",
    AuthorizationFailed(account: String) => "Key cannot authorize account: {account}",
}
