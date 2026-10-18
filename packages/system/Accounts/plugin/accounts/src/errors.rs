use psibase::plugin_error;

plugin_error! {
    pub ErrorType
    InvalidAccountName(msg: String) => "Invalid account name: {msg}",
    DeserializationError(msg: String) => "Deserialization error: {msg}",
}
