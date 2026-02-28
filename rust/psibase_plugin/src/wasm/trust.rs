//! # `psibase_plugin::trust`
//!
//! This module wraps the `permissions` plugin, adding syntactic sugar to make it
//! more natural to use in rust.
//!
//! The permissions plugin provides a default implementation of an oauth-like
//! authorization mechanism for client-side inter-app authorization.
//!
//! ## Usage
//!
//! ### Step 1
//!
//! Implement the `TrustConfig` trait for your plugin. The `low`, `medium`, and `high`
//! arrays contain strings that describe each capability granted by that trust level.
//!
//! ```rust
//! impl TrustConfig for MyPlugin {
//!     fn capabilities() -> Capabilities {
//!         Capabilities {
//!             low: &["Read-only access to my plugin's public data"],
//!             medium: &["Update user data on the server"],
//!             high: &["Read/write access to private user data"],
//!         }
//!     }
//! }
//! ```
//!
//! To better understand how to categorize functionality into trust levels, see the `permissions`
//! plugin documentation.
//!
//! ### Step 2
//!
//! Annotate your plugin functions with the `authorized` macro:
//!
//! ```ignore
//! #[psibase_plugin::authorized(High)]
//! fn my_high_trust_function() -> Result<(), Error> {
//!     // ...
//!     Ok(())
//! }
//! ```
//!
//! Optionally, you can provide a whitelist of third-party callers that are pre-authorized to call
//! this function on behalf of the user.
//!
//! ```ignore
//! #[psibase_plugin::authorized(High, whitelist = ["trusted-app"])]
//! fn my_high_trust_function() -> Result<(), Error> {
//!     // ...
//!     Ok(())
//! }
//! ```

use crate::types::Error;
use crate::wasm::host;
use crate::wasm::permissions;
pub use crate::wasm::permissions::types::TrustLevel;

pub struct Capabilities {
    pub low: &'static [&'static str],
    pub medium: &'static [&'static str],
    pub high: &'static [&'static str],
}

impl Capabilities {
    fn format(items: &[&str]) -> String {
        items
            .iter()
            .map(|s| format!("- {s}"))
            .collect::<Vec<_>>()
            .join("\n")
    }

    pub fn to_descriptions(&self) -> (String, String, String) {
        (
            Self::format(self.low),
            Self::format(self.medium),
            Self::format(self.high),
        )
    }
}

pub trait TrustConfig {
    fn capabilities() -> Capabilities;

    fn assert_authorized(level: TrustLevel, fn_name: &str) -> Result<(), Error>
    where
        Self: Sized,
    {
        Self::assert_authorized_with_whitelist(level, fn_name, &[])
    }

    fn assert_authorized_with_whitelist(
        level: TrustLevel,
        fn_name: &str,
        whitelist: &[&str],
    ) -> Result<(), Error>
    where
        Self: Sized,
    {
        assert_authorized_with_whitelist::<Self>(level, fn_name, whitelist)
    }

    fn get_descriptions() -> (String, String, String) {
        Self::capabilities().to_descriptions()
    }
}

pub fn assert_authorized<T: TrustConfig>(level: TrustLevel, fn_name: &str) -> Result<(), Error> {
    assert_authorized_with_whitelist::<T>(level, fn_name, &[])
}

pub fn assert_authorized_with_whitelist<T: TrustConfig>(
    level: TrustLevel,
    fn_name: &str,
    whitelist: &[&str],
) -> Result<(), Error> {
    let whitelist: Vec<String> = whitelist.iter().map(|s| s.to_string()).collect();
    let descriptions = T::get_descriptions();
    let authorized = permissions::api::is_authorized(
        &host::client::get_sender(),
        level,
        &descriptions,
        fn_name,
        &whitelist,
    )?;
    if !authorized {
        panic!("Unauthorized call to: {fn_name}");
    }
    Ok(())
}
