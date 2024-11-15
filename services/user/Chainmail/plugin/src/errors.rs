use psibase::plugin_error;

plugin_error! {
    #[derive(Debug)]
    pub ErrorType
    QueryResponseParseError(msg: String) => "Query response parsing error: {msg}",
    InvalidMsgId(msg: String) => "No message found with msg_id {msg}",
    DateTimeConversion(msg: String) => "Invalid DateTime: {msg}"
}
