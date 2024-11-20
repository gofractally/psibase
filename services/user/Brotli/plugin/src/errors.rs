use psibase::plugin_error;

plugin_error! {
    pub ErrorType
    InvalidQuality(quality: u8) => "Invalid quality: {quality}",
}
