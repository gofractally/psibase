use psibase::plugin_error;

plugin_error! {
    pub ErrorType
    NotYetImplemented(msg: String) => "Not yet implemented: {msg}",
    LoginRequired => "Login required",
}
