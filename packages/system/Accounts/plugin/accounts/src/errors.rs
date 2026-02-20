use psibase::plugin_error;

plugin_error! {
    pub ErrorType<'a>
    Unauthorized(msg: &'a str) => "Unauthorized access: {msg}",
    InvalidAccountName(msg: String) => "Invalid account name: {msg}",
    InvalidApp(msg: String) => "Invalid app: {msg}",
    QueryError(msg: String) => "Graphql query error: {msg}",
    DeserializationError(msg: String) => "Deserialization error: {msg}",
    NotConnected(user: String) => "User {user} is not connected to this app",
    CannotCreateAccount() => "Cannot create account",
    MaxGenerationAttemptsExceeded() => "Max generation attempts exceeded",
    InvalidPrefix() => "Prefix must be a-z, 1 - 9 chars in length",
    AccountNotFound(account: String) => "Account not found: {account}",
    UnsupportedAuthService(service: String) => "Account uses unsupported auth service: {service}",
    AuthorizationFailed(account: String) => "Key cannot authorize account: {account}"
}
