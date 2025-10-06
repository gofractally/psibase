use psibase::plugin_error;

plugin_error! {
    pub ErrorType<'a>
    Unauthorized() => "Unauthorized",
    QueryError(msg: String) => "Graphql error: {msg}",
    AccountExists(msg: &'a str) => "[{msg}] Error: Account already exists",
    InviteNotValid() => "Error: Invite is no longer valid or expired",
}
