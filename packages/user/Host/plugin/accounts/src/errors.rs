use psibase::plugin_error;

plugin_error! {
    pub ErrorType<'a>
    Unauthorized(msg: &'a str) => "Unauthorized access: {msg}",
    NotConnected(user: String) => "User {user} is not connected to this app",
    AccountNotFound(account: String) => "Account not found: {account}",
    UnsupportedAuthService(service: String) => "Account uses unsupported auth service: {service}",
    AuthorizationFailed(account: String) => "Key cannot authorize account: {account}",
}
