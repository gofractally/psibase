use psibase::plugin_error;

plugin_error! {
    pub ErrorType<'a>
    NotYetImplemented(msg: &'a str) => "Not yet implemented: {msg}",
}
