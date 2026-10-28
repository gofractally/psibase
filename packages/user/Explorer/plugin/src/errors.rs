use psibase::plugin_error;

plugin_error! {
    pub ErrorType
    JsonError(msg: String) => "JSON error: {msg}",
}
