use psibase::plugin_error;

plugin_error! {
    pub ErrorType
    Unauthorized(context: String, caller_app: String) => "Unauthorized call to staged-tx plugin ({context}) from {caller_app}",
    InvalidAccount(account: String) => "Account DNE: {account}",
    InvalidTxId => "Invalid txid",
    InvalidSender(sender: String) => "Invalid sender: {sender}",
    NoCurrentUser => "User must be logged in",
    NetworkAppsOnly(context: String) => "[{context}] only callable from network apps or their plugins",
    ActiveAppOnly(context: String) => "[{context}] only callable from the currently active app",
}
