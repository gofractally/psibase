#[allow(warnings)]
mod bindings;

use bindings::exports::app_registry::plugin::test::Guest as Test;
use bindings::host::common::types as CommonTypes;

struct AppRegistryPlugin;

impl Test for AppRegistryPlugin {
    fn foo() -> Result<(), CommonTypes::Error> {
        Ok(())
    }
}

bindings::export!(AppRegistryPlugin with_types_in bindings);
