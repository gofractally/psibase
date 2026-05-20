use psibase::plugin_error;

plugin_error! {
    pub ErrorType
    InvalidAccountNumber(account: String) => "Invalid account number: {account}",
}
