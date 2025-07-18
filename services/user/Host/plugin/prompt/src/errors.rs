use psibase::plugin_error;

plugin_error! {
    pub ErrorType
    NoActivePrompt() => "[Error] No active prompt",
    PromptNotFound(id: u32) => "[Error] Prompt not found: {id}",
    PromptExpired(id: u32) => "[Error] Prompt expired: {id}",
    InvalidSubpath() => "[Error] Invalid subpath. Subpath must not be a full URL.",
}
