// This macro helps reduce boilerplate in rust plugins related to defining trust settings.

/// Using this macro in your plugin will automatically generate a `trust` module with
/// an `authorize` function that calls the permissions plugin to facilitate user
/// prompts to grant permission to other plugins (callers) to call your plugin functions (callees).
///
/// The `trust` module also exports a variable for each named function.
///
/// To use this macro, you must also link your plugin to `permissions:plugin` and add its imports
/// to your plugin's target world.
///
/// Example usage:
/// ```rust,ignore
/// define_trust! {
///     descriptions {
///         1 => "
///             Level 1 trust grants these abilities:
///             - Create new keypairs
///             - Import existing keypairs
///         ",
///         3 => "
///             Level 3 trust grants these abilities:
///             - Set the public key for your account
///             - Sign transactions on your behalf
///             - Read the private key for a given public key
///             - Create new keypairs
///             - Import existing keypairs
///         ",
///     }
///     functions {
///         1 => [generate_keypair, import_key],
///         3 => [set_key],
///     }
/// }
///
/// // ...
///
/// fn generate_keypair() -> Result<String, CommonTypes::Error> {
///     authorize(trust::generate_keypair, Some(vec!["invite".into()]))?;
///     // ...
/// }
///
/// ```
#[macro_export]
macro_rules! define_trust {
    (
        descriptions {
            $($desc_level:literal => $desc:literal,)*
        }
        functions {
            $($func_level:literal => [$($func_name:ident),* $(,)?],)*
        }
    ) => {
        use crate::bindings::permissions::plugin::types::Trust;
        use std::collections::HashMap;

        $crate::lazy_static::lazy_static! {
            static ref TRUST_LEVELS: HashMap<&'static str, u8> = TrustRequirement::get_trust_levels();
        }

        struct TrustRequirement;

        impl TrustRequirement {
            fn get_trust_levels() -> HashMap<&'static str, u8> {
                let mut map = HashMap::new();
                $(
                    $(
                        map.insert(stringify!($func_name), $func_level);
                    )*
                )*
                map
            }

            fn get_description(level: u8) -> String {
                match level {
                    $(
                        $desc_level => $crate::indoc::indoc! { $desc },
                    )*
                    _ => "",
                }
                .to_string()
            }

            fn get_level(fn_name: &str) -> u8 {
                *TRUST_LEVELS.get(fn_name).unwrap_or(&4)
            }
        }

        fn get_trust_requirement(fn_name: &str) -> Trust {
            let level = TrustRequirement::get_level(fn_name);
            Trust {
                level,
                description: TrustRequirement::get_description(level),
            }
        }

        pub mod trust {
            use crate::bindings::host::common::client::get_sender;
            use crate::bindings::host::common::types::Error;
            use crate::bindings::permissions::plugin::api as Permissions;
            use super::get_trust_requirement;

            pub fn authorize(fn_name: &str, whitelist: Option<Vec<String>>) -> Result<(), Error> {

                let whitelist = whitelist.unwrap_or_default();
                Permissions::authorize(
                    &get_sender(),
                    &get_trust_requirement(fn_name),
                    fn_name,
                    &whitelist,
                )?;
                Ok(())
            }

            $(
                $(
                    #[allow(non_upper_case_globals)]
                    pub const $func_name: &'static str = stringify!($func_name);
                )*
            )*
        }
    };
}
