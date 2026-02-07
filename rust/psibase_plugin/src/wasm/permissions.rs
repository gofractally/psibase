pub mod api {
    use crate::types::Error;
    use crate::wasm::bindings::permissions::plugin::api;
    use crate::wasm::bindings::permissions::plugin::types::{Descriptions, TrustLevel};

    pub fn is_authorized(
        caller: &str,
        level: TrustLevel,
        descriptions: &Descriptions,
        debug_label: &str,
        whitelist: &[String],
    ) -> Result<bool, Error> {
        api::is_authorized(caller, level, descriptions, debug_label, whitelist)
    }
}

pub mod types {
    pub use crate::wasm::bindings::permissions::plugin::types::TrustLevel;
}
