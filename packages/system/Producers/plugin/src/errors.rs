use psibase::plugin_error;

plugin_error! {
    pub ErrorType<'a>
    InvalidResponse(msg: String) => "Invalid response: {msg}",
    ProducersNotFound(msg: &'a str) => "Producers not found: {msg}",
}
