#[allow(warnings)]
mod bindings;

use bindings::exports::test_package::plugin::test::Guest as Test;
use bindings::host::types::types as CommonTypes;

struct TestPlugin;

impl Test for TestPlugin {
    fn foo() -> Result<(), CommonTypes::Error> {
        Ok(())
    }
}

bindings::export!(TestPlugin with_types_in bindings);
