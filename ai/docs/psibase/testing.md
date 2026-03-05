# Testing

> AI-focused summary. Official: `doc/src/development/services/rust-service/testing.md`.

## Rust service tests

- **Attribute**: `#[psibase::test_case(packages("PackageName"))]` or `#[psibase::test_case(services("service-name"))]`. `packages(...)` refers to `package.metadata.psibase.package-name` (case-sensitive); the test chain is initialized with default packages plus those listed.
- **Runner**: `cargo psibase test`. Builds the service(s) and tests, then runs them with **psitest** (in-repo or from SDK).
- **Chain**: Tests get a simulated chain. Create accounts with `chain.new_account(account!("alice"))?`. Push transactions with `Wrapper::push(&chain).action_name(args).get()?` or `Wrapper::push_from(&chain, account!("alice")).action_name(args).get()?`. Use `chain.start_block()` to avoid duplicate-transaction rejection when reusing the same action.
- **Reading tables in tests**: Use `Table::with_service(SERVICE)` (or the constant that identifies the service account) so the table is opened for the correct service; `Table::new()` in a test context may use `get_service()` which returns 0 and finds no rows.
- **Trace**: `Wrapper::push(...).trace` (or equivalent) to inspect call chain and console output.

## Multi-service tests

- Depend on all service crates; use `packages("PackageName")` if the package includes multiple services. Call `other_service::Wrapper::push(&chain).action(...).get()?` or `other_service::Wrapper::call()` from inside a service action for in-process calls.
- For cross-service calls, deploy both services to the test chain (via the same package or dependencies) and call as a user would.

## C++ / CMake tests

- Repo defines tests in `rust/CMakeLists.txt` (e.g. `rs-test-psibase-macros`, `rs-test-package`) and in `packages/*/test` or similar. They run `cargo psibase test` with a specific manifest and `--psitest=...`.
- Run the full test suite via CMake/CTest from the build directory.

## Integration / deploy verification

- Install the package on a local node (`cargo psibase install`, or load a snapshot) and manually or automatically hit HTTP/GraphQL and plugin flows. No single canonical “integration test” layout; add scripts or test commands as needed.
- Events: If tests depend on event history, note that events are prunable; prefer asserting on current state when possible.

## References

- Rust testing: `doc/src/development/services/rust-service/testing.md`
- Tables in tests: `doc/src/development/services/rust-service/tables.md` (Reading Tables in Test Cases)
- Test targets: `rust/CMakeLists.txt`, `packages/user/Invite/test`, etc.
