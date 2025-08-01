use psibase::plugin_error;

plugin_error! {
    pub ErrorType
    InvalidSubpath() => "[Error] Invalid subpath. Subpath must not be a full URL.",
}
