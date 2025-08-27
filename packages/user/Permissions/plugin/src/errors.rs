use psibase::plugin_error;

plugin_error! {
    pub ErrorType
    LoggedInUserDNE(caller: String, callee: String, debug_label: String) => "[{caller} -> {callee}] - {debug_label} - User must be logged in to perform this action",
    InvalidCaller(caller: String, callee: String, debug_label: String) => "[{caller} -> {callee}] - {debug_label} - Only the active app (or 'allowed callers') can request permission.",
}
