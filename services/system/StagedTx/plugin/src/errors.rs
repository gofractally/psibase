use psibase::plugin_error;

plugin_error! {
    pub ErrorType
    Unauthorized(context: String, caller_app: String) => "Unauthorized call to staged-tx plugin ({context}) from {caller_app}",
    InvalidAccount(account: String) => "Account DNE: {account}",
}
