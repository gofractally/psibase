use psibase::plugin_error;

plugin_error! {
    pub ErrorType
    InvalidAccountName(msg: String) => "Invalid account name: {msg}",
    QueryError(msg: String) => "Graphql query error: {msg}",
    CannotCreateAccount() => "Cannot create account",
    AccountNotFound(account: String) => "Account not found: {account}",
    UnsupportedAuthService(service: String) => "Account uses unsupported auth service: {service}",
    AuthorizationFailed(account: String) => "Key cannot authorize account: {account}",
}
