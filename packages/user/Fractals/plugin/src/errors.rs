use psibase::plugin_error;

plugin_error! {
    pub ErrorType
    QueryResponseParseError(msg: String) => "Query response parsing error: {msg}",
    NoSender => "No sender app",
    InvalidSender(sender: String) => "Sender origin app must be fractals or fractal, received: {sender}",
    InvalidAccountNumber => "Invalid account number",

}
