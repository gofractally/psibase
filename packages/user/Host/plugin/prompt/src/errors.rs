use psibase::plugin_error;

plugin_error! {
    pub ErrorType
    PromptContextNotFound(context_id: String) => "[Error] Prompt context not found: {context_id}",
}
