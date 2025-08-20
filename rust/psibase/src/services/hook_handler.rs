#[macro_export]
macro_rules! define_service_hooks {
    ($(($parent_service:expr, $($hook_name:ident),*)),*) => {
        #[allow(non_camel_case_types)]
        enum ServiceHook {
            $(
                $(
                    $hook_name {
                        hook: $crate::MethodNumber,
                        data: action_structs::$hook_name,
                    },
                )*
            )*
            Unknown,
        }

        impl ServiceHook {
            fn new(hook_name: &str, data: &[u8]) -> Self {
                use $crate::fracpack::Unpack;

                match hook_name {
                    $(
                        $(
                            action_structs::$hook_name::ACTION_NAME => {
                                ServiceHook::$hook_name {
                                    hook: $crate::MethodNumber::from(action_structs::$hook_name::ACTION_NAME),
                                    data: action_structs::$hook_name::unpacked(data).unwrap(),
                                }
                            },
                        )*
                    )*
                    _ => {
                        ServiceHook::Unknown
                    }
                }
            }

            fn execute(self) {
                let my_service = get_service();
                let s = ServiceCaller {
                    sender: my_service,
                    service: my_service,
                };

                match self {
                    $(
                        $(
                            ServiceHook::$hook_name { hook, data } => {
                                $crate::check(get_sender() == $parent_service, "Invalid sender");
                                s.call_returns_nothing(hook, data);
                            },
                        )*
                    )*
                    ServiceHook::Unknown => {
                        // No-op instead of panic for unrecognized hooks
                        // This allows the parent service to add new hook types without breaking child apps
                    }
                }
            }
        }
    };
}

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
