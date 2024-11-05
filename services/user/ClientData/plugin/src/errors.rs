use psibase::plugin_error;

plugin_error! {
    pub ErrorType
    EmptyValue(key: String) => "Cannot add empty value for key: {key}",
}
