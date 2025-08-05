use psibase::plugin_error;

plugin_error! {
    pub ErrorType
    LoggedInUserDNE(caller: String, callee: String, debug_label: String) => "[{caller} -> {callee}] - {debug_label} - User must be logged in to perform this action",
    InvalidTrustLevel(callee: String, level: u8, debug_label: String) => "[{callee}] - {debug_label} - Invalid trust level: {level}. Must be between 1 and 3 inclusive.",
}
