// This macro helps reduce boilerplate in rust plugins related to defining trust settings.

/// Using this macro in your plugin will automatically generate a `trust` module with
/// an `is_authorized` function that calls the permissions plugin to facilitate user
/// prompts to grant permission to other plugins (callers) to call your plugin functions (callees).
///
/// The `trust` module also exports a variable for each named function.
///
/// To use this macro, you must also link your plugin to `permissions:plugin` and add its imports
/// to your plugin's target world.
///
/// Valid trust levels are: [None, Low, Medium, High, Max]
///
/// Example usage:
/// ```rust,ignore
/// psibase::define_trust! {
///     descriptions {
///         Low => "
///         Low trust grants these abilities:
///             - Create new keypairs
///             - Import existing keypairs
///         ",
///         Medium => "",
///         High => "
///         High trust grants the abilities of all lower trust levels, plus these abilities:
///             - Set the public key for your account
///             - Sign transactions on your behalf
///         ",
///     }
///     functions {
///         None => [generate_unmanaged_keypair, pub_from_priv, to_der, sign],
///         Low => [generate_keypair, import_key],
///         High => [set_key],
///     }
/// }
///
/// // ...
///
/// fn generate_keypair() -> Result<String, CommonTypes::Error> {
///     // Use `is_authorized_with_whitelist` to check that the caller has been given a sufficient trust level by the
///     // user to call this function on their behalf, or that the caller is in the specified whitelist.
///     is_authorized_with_whitelist(trust::FunctionName::generate_keypair, vec!["invite".into()])?;
///     // ...
/// }
///
/// fn sign(hashed_message: Vec<u8>, private_key: Vec<u8>) -> Result<Vec<u8>, CommonTypes::Error> {
///     // Use `is_authorized` to check that the caller has been given a sufficient trust level by the user to call this
///     // function on their behalf.
///     is_authorized(trust::FunctionName::sign)?;
///     // ...
/// }
///
/// ```
#[macro_export]
macro_rules! define_trust {
    (
        descriptions {
            $($desc_level:ident => $desc:literal,)*
        }
        functions {
            $($func_level:ident => [$($func_name:ident),* $(,)?],)*
        }
    ) => {

        pub mod trust {
            use crate::bindings::host::common::client::get_sender;
            use crate::bindings::host::types::types::Error;
            use crate::bindings::permissions::plugin::api as Permissions;

            #[derive(Copy, Clone)]
            #[allow(non_camel_case_types)]
            pub enum FunctionName {
                $(
                    $(
                        $func_name,
                    )*
                )*
            }

            impl FunctionName {
                pub fn as_str(&self) -> &'static str {
                    match self {
                        $(
                            $(
                                Self::$func_name => stringify!($func_name),
                            )*
                        )*
                    }
                }
            }

            struct TrustRequirement;

            impl TrustRequirement {
                fn get_descriptions() -> crate::bindings::permissions::plugin::types::Descriptions {
                    (
                        $(
                            $crate::indoc::indoc! { $desc }.to_string(),
                        )*
                    )
                }

                fn get_level(fn_name: FunctionName) -> crate::bindings::permissions::plugin::types::TrustLevel {
                    match fn_name {
                        $(
                            $(
                                FunctionName::$func_name => crate::bindings::permissions::plugin::types::TrustLevel::$func_level,
                            )*
                        )*
                    }
                }
            }


            pub fn is_authorized(fn_name: FunctionName) -> Result<bool, Error> {
                is_authorized_with_whitelist(fn_name, vec![])
            }

            pub fn assert_authorized(fn_name: FunctionName) -> Result<(), Error> {
                if !is_authorized(fn_name)? {
                    panic!("Unauthorized call to: {}", fn_name.as_str());
                }

                Ok(())
            }

            pub fn is_authorized_with_whitelist(fn_name: FunctionName, whitelist: Vec<String>) -> Result<bool, Error> {
                Permissions::is_authorized(
                    &get_sender(),
                    TrustRequirement::get_level(fn_name),
                    &TrustRequirement::get_descriptions(),
                    fn_name.as_str(),
                    &whitelist,
                )
            }

            pub fn assert_authorized_with_whitelist(fn_name: FunctionName, whitelist: Vec<String>) -> Result<(), Error> {
                if !is_authorized_with_whitelist(fn_name, whitelist)? {
                    let err_msg = format!("Unauthorized call to: {}", fn_name.as_str());
                    panic!("{}", err_msg);
                }

                Ok(())
            }
        }
    };
}
