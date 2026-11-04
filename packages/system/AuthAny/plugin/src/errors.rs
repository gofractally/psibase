use psibase::plugin_error;

plugin_error! {
    pub ErrorType<'a>
    Unauthorized(msg: &'a str) => "Unauthorized: {msg}",
}
