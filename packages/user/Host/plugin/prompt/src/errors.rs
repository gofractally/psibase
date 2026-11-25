use psibase::plugin_error;

plugin_error! {
    pub ErrorType
    PromptContextNotFound(context_id: String) => "[Error] Prompt context not found: {context_id}",
    ContextAppMismatch => "[Error] Only the app which created this prompt may read its context",
}
