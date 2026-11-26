use psibase::plugin_error;

plugin_error! {
    pub ErrorType
    InvalidAccount(msg: String) => "Invalid account: {msg}",
    NotLoggedIn() => "Not logged in",
    QueryError(msg: String) => "GraphQL query error: {msg}",
    ConversionError(msg: String) => "Amount conversion error: {msg}",
    AssetNotFound(id: String) => "Asset not found: {id}",
    AmountIsZero() => "Amount must be greater than zero",
}
