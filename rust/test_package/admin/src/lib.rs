#[allow(warnings)]
mod bindings;

use bindings::exports::test_package::admin::test::Guest as Test;
use bindings::host::types::types as CommonTypes;

struct TestAdmin;

impl Test for TestAdmin {
    fn bar() -> Result<(), CommonTypes::Error> {
        Ok(())
    }
}

bindings::export!(TestAdmin with_types_in bindings);
