use psibase::plugin_error;

plugin_error! {
    pub ErrorType
    QueryResponseParseError(msg: String) => "Query response parsing error: {msg}",
    ContactNotFound(account: String) => "Contact not found: {account}",
    ContactAlreadyExists(account: String) => "Contact already exists: {account}",
    InvalidAccountNumber(account: String) => "Invalid account name: {account}",
}