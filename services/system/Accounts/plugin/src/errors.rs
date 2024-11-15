use psibase::plugin_error;

plugin_error! {
    pub ErrorType<'a>
    NotYetImplemented(msg: &'a str) => "Not yet implemented: {msg}",
    Unauthorized(msg: &'a str) => "Unauthorized access: {msg}",
    InvalidAccountName(msg: String) => "Invalid account name: {msg}",
    QueryError(msg: String) => "Graphql query error: {msg}",
}
