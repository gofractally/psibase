#[allow(warnings)]
mod bindings;

use bindings::exports::workshop::plugin::test::Guest as Test;
use bindings::host::common::types as CommonTypes;

struct WorkshopPlugin;

impl Test for WorkshopPlugin {
    fn foo() -> Result<(), CommonTypes::Error> {
        Ok(())
    }
}

bindings::export!(WorkshopPlugin with_types_in bindings);
