use psibase::plugin_error;

plugin_error! {
    pub ErrorType
    CryptoError(msg: String) => "Crypto error: {msg}",
}
