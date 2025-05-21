# Service Initialization

The `service_init` macro is used to initialize a service's tables/state and to ensure that actions check for initialization before executing their logic. This macro combines the functionality of initializing the service and performing pre-action checks.

A full example of `service_init` is available in `/rust/test_psibase_macros/services/add-check-init/`.

1. Add `service_init` attribute to the function that initializes the service and checks for initialization.
2. Optionally include a list of actions that should _not_ check that the service is initialized, e.g., the `init` action.

```rust
#[psibase::service(tables = "tables::tables")]
mod service {

    #[service_init]
    fn init() {
        // your init code here
    }

    // ... other service actions and events ...

}
```

This approach ensures that your service is properly initialized and that actions are checked for initialization, while still allowing flexibility in which actions are exempt from these checks.
