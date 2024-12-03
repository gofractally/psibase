# Service Initialization

Typically, an `init` action is used to initialize a service's tables/state before it serves other actions. It is also common and advised for actions to confirm a service has been initialized before executing their logic. The `pre_action` attribute provides a mechanism for doing this check.

A full example os `pre_action` is available in `/rust/test_psibase_macros/services/add-check-init/`.

1. Add `pre_action` attribute to the function that checks that the service has been initialized.
2. Optionally include a list of actions that should _not_ check that the service is initialized, e.g., the `init` action.

```rust
#[action]
fn init() {
    let table = InitTable::new();
    table.put(&InitRow {}).unwrap();
}

#[pre_action(exclude(init))]
fn check_init() {
    let table = InitTable::new();
    check(
        table.get_index_pk().get(&()).is_some(),
        "service not initialized",
    );
}
```
