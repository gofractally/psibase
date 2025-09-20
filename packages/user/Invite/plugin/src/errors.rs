use psibase::plugin_error;

plugin_error! {
    pub ErrorType<'a>
    QueryError(msg: String) => "Graphql error: {msg}",
    AccountExists(msg: &'a str) => "[{msg}] Error: Account already exists",
}
