use psibase::plugin_error;

plugin_error! {
    pub ErrorType
    NoActivePrompt() => "[Error] No active prompt",
    PromptNotFound(id: u32) => "[Error] Prompt not found: {id}",
    PromptExpired(id: u32) => "[Error] Prompt expired: {id}",
    InvalidSubpath() => "[Error] Invalid subpath. Subpath must not be a full URL.",
    PromptContextNotFound(context_id: String) => "[Error] Prompt context not found: {context_id}",
    InvalidPromptName() => "[Error] Invalid prompt name. Prompt name must be [a-zA-Z0-9].",
    OpenPromptError(err: String) = 999999999 => "{err}",
}
