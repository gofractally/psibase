use psibase::plugin_error;

plugin_error! {
    pub ErrorType<'a>
    DecodeInviteError(msg: &'a str) => "Failed to decode invite ID: {msg}",
    QueryError(msg: String) => "Graphql error: {msg}",
    DatetimeError(msg: &'a str) => "Datetime error: {msg}",
    InvalidInvite(msg: &'a str) => "Invalid invite: {msg}",
    InvalidInviteState(msg: &'a str) => "Invalid invite state: {msg}",
    InvalidAccount(account: &'a str) => "Invalid account name: {account}",
    AccountExists(msg: &'a str) => "[{msg}] Error: Account already exists",
}
