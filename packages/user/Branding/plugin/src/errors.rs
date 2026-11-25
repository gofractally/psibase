use psibase::plugin_error;

plugin_error! {
    pub ErrorType
    QueryResponseParseError(msg: String) => "Query response parsing error: {msg}",
    QueryAuthError(msg: String) => "Query auth error: {msg}",
    LogoTooBig(max: usize) => "Logo exceeds max size of {max} bytes",
    InvalidLogoContentType(content_type: String) => "Logo content type not allowed: {content_type}. Use PNG, JPEG, or WebP",
}
