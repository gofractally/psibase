#[crate::service(
    name = "hook-handler",
    actions = "hook_handler_actions",
    wrapper = "hook_handler_wrapper",
    structs = "hook_handler_structs",
    dispatch = false,
    pub_constant = false,
    psibase_mod = "crate"
)]
#[allow(non_snake_case, unused_variables)]
pub mod HookHandler {
    #[action]
    fn handle_hook(hook_name: String, hook_data: Vec<u8>) {
        unimplemented!()
    }
}

/// Syntactic sugar for calling dynamic hooks
pub fn call_hook<T>(service: crate::AccountNumber, data: T)
where
    T: fracpack::Pack + crate::ActionMeta,
{
    let hook_name = T::ACTION_NAME.to_string();
    hook_handler_wrapper::call_to(service).handle_hook(hook_name, data.packed());
}
