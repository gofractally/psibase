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
///             - Read the private key for a given public key
///         ",
///     }
///     functions {
///         None => [generate_unmanaged_keypair, pub_from_priv, to_der, sign],
///         Low => [generate_keypair, import_key],
///         High => [priv_from_pub, set_key],
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
            $($desc_level:ident => $desc:literal,)*
        }
        functions {
            $($func_level:ident => [$($func_name:ident),* $(,)?],)*
        }
    ) => {

        $crate::lazy_static::lazy_static! {
            static ref TRUST_LEVELS: std::collections::HashMap<&'static str, crate::bindings::permissions::plugin::types::TrustLevel> = TrustRequirement::get_trust_levels();
        }

        struct TrustRequirement;

        impl TrustRequirement {
            fn get_trust_levels() -> std::collections::HashMap<&'static str, crate::bindings::permissions::plugin::types::TrustLevel> {
                let mut map = std::collections::HashMap::new();
                $(
                    $(
                        map.insert(stringify!($func_name), crate::bindings::permissions::plugin::types::TrustLevel::$func_level);
                    )*
                )*
                map
            }

            fn get_descriptions() -> crate::bindings::permissions::plugin::types::Descriptions {
                (
                    $(
                        $crate::indoc::indoc! { $desc }.to_string(),
                    )*
                )
            }

            fn get_level(fn_name: &str) -> crate::bindings::permissions::plugin::types::TrustLevel {
                *TRUST_LEVELS.get(fn_name).unwrap_or(&crate::bindings::permissions::plugin::types::TrustLevel::Max)
            }
        }

        pub mod trust {
            use super::TrustRequirement;
            use crate::bindings::host::common::client::get_sender;
            use crate::bindings::host::common::types::Error;
            use crate::bindings::permissions::plugin::api as Permissions;

            pub fn authorize(fn_name: &str, whitelist: Option<Vec<String>>) -> Result<(), Error> {
                let whitelist = whitelist.unwrap_or_default();
                Permissions::authorize(
                    &get_sender(),
                    TrustRequirement::get_level(fn_name),
                    &TrustRequirement::get_descriptions(),
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
