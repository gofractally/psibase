use psibase::plugin_error;

plugin_error! {
    pub ErrorType
    QueryError(msg: String) => "Failed to post graphql query: {msg}",
    NotFound(msg: String) = 404 => "{msg}",
    QueryDeserializeError(msg: String) => "Failed to deserialize graphql query response: {msg}",
}
