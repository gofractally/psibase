use psibase::plugin_error;

plugin_error! {
    pub ErrorType<'a>

    CryptoError(msg: String) => "Crypto error: {msg}",
    Unauthorized(msg: String) => "Unauthorized: {msg}",
    JsonDecodeError(msg: String) => "JSON decode error: {msg}",
    KeyNotFound(msg: &'a str) => "Key not found: {msg}",
    InsufficientPermissions(privileged_action: String) => "Insufficient access for {privileged_action}"
}
