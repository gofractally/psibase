use psibase::plugin_error;

plugin_error! {
    pub ErrorType
    QueryResponseParseError(msg: String) => "Query response parsing error: {msg}",
    ContactNotFound(account: String) => "Contact not found: {account}",
    InvalidAccountNumber(account: String) => "Invalid account name: {account}",
    NoUserLoggedIn() => "Not logged in",
    NoAccountFound(account: String) => "No account found: {account}",
    UnauthorizedApp() => "App sender must be home page",
    ContactAlreadyExists(account: String) => "Contact already exists: {account}",
}
