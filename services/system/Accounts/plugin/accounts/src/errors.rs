use psibase::plugin_error;

plugin_error! {
    pub ErrorType<'a>
    Unauthorized(msg: &'a str) => "Unauthorized access: {msg}",
    InvalidAccountName(msg: String) => "Invalid account name: {msg}",
    InvalidApp(msg: String) => "Invalid app: {msg}",
    QueryError(msg: String) => "Graphql query error: {msg}",
}
