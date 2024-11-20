use psibase::plugin_error;

plugin_error! {
    pub ErrorType<'a>
    FileTooLarge(msg: &'a str) => "File too large: {msg}",
    InvalidCompressionQuality(quality: u8) => "Invalid compression quality: {quality}",
}
