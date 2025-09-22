use psibase::plugin_error;

plugin_error! {
    pub ErrorType
    NotImplemented(msg: String) => "Feature not implemented: {msg}",
}
