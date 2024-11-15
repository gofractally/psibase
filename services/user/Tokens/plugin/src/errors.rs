use psibase::plugin_error;

plugin_error! {
    pub ErrorType<'a>
    QueryError(msg: String) => "Failed to post graphql query: {msg}",
    InvalidTokenId(msg: &'a str) => "Invalid token ID: {msg}",
    TokenNumberMismatch(msg: &'a str) => "Token number mismatch: {msg}",
    NotImplemented(msg: &'a str) => "Feature not implemented: {msg}",
}
