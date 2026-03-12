use psibase::plugin_error;

plugin_error! {
    pub ErrorType
    StorageError(msg: String) => "Storage error: {msg}"
}
