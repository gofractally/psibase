# Skill: service-testing

**Name:** service-testing  
**When to load:** Story involves testing Rust services: writing test cases, using the simulated chain, or asserting on table state.  
**Prerequisites:** Rust service (and optionally other services it calls); `cargo psibase test` and psitest.

---

## Core Knowledge

- **Attribute:** `#[psibase::test_case(packages("PackageName"))]` or `#[psibase::test_case(services("service-name"))]`. `packages(...)` uses `package.metadata.psibase.package-name` (case-sensitive). The test chain is initialized with default packages plus those listed.
- **Runner:** `cargo psibase test` — builds the service(s) and tests, runs them with **psitest** (from repo or SDK).
- **Chain:** You get a simulated chain. Create accounts with `chain.new_account(account!("alice"))?`. Push transactions with `Wrapper::push(&chain).action_name(args).get()?` or `Wrapper::push_from(&chain, account!("alice")).action_name(args).get()?`. Use `chain.start_block()` between transactions to avoid duplicate-transaction rejection.
- **Reading tables in tests:** Use `Table::with_service(SERVICE)` (the constant for the service’s account), not `Table::new()`. In test context `get_service()` returns 0, so `new()` would open the table for the wrong account and find no rows.

Refs: `doc/src/development/services/rust-service/testing.md`, `ai/docs/psibase/testing.md`, `doc/src/development/services/rust-service/tables.md` (Reading Tables in Test Cases).

---

## Skill: write-service-test

1. In the service crate (or a test crate that depends on it), add a function with `#[psibase::test_case(packages("PackageName"))]` (or `services("server-name")`). The parameter is `chain: psibase::Chain`.
2. Create accounts: `chain.new_account(account!("alice"))?;`
3. Push transactions: `Wrapper::push(&chain).action_name(args).get()?` or `Wrapper::push_from(&chain, account!("alice")).action_name(args).get()?`. Use `.get()?` to get the result or propagate error.
4. Assert on return values or on chain state. For table state, open the table with `TableName::with_service(SERVICE).get_index_pk().iter().collect::<Vec<_>>()` (or the appropriate index) and assert.
5. If you need another transaction with the same action (e.g. same sender/method/args), call `chain.start_block()` first to avoid duplicate rejection.

Example:

```rust
#[psibase::test_case(packages("Example"))]
fn test_arith(chain: psibase::Chain) -> Result<(), psibase::Error> {
    assert_eq!(Wrapper::push(&chain).add(3, 4).get()?, 7);
    chain.start_block();
    assert_eq!(Wrapper::push(&chain).multiply(3, 4).get()?, 12);
    Ok(())
}
```

---

## Skill: run-tests

- **Single package:** From the package root (where `[package.metadata.psibase]` is), run `cargo psibase test`. This builds the service and tests and runs psitest.
- **Workspace:** Run from the workspace root with the correct manifest, e.g. `cargo psibase test --manifest-path packages/user/SomePackage/Cargo.toml`, or from the member directory.
- **Trace:** Use `Wrapper::push(...).trace` (or equivalent) to print the call trace and console output for debugging.
- **Multi-service:** List all needed services in the same package or as dependencies; use `packages("PackageName")` if the package includes multiple services. Call other services with `other::Wrapper::push(&chain).action(...).get()?` for cross-service tests.

---

## Gotchas

- **Table in tests:** Always `Table::with_service(SERVICE)` (or the correct service account constant). `Table::new()` uses `get_service()` which is 0 in tests.
- **Duplicate transaction:** Same sender + service + method + args in the same block can be rejected. Use `chain.start_block()` before re-running a similar transaction.
- **Package name:** Must match `package-name` in Cargo.toml exactly (case-sensitive).

---

## Verification

- `cargo psibase test` passes. If tests read tables, confirm the assertions match the intended state (e.g. row count, field values).

---

## Related Skills

- **service-tables** — asserting on table contents (with_service, get_index_*).
- **service-actions** — testing actions (push, push_from, get).

---

## References

- `doc/src/development/services/rust-service/testing.md`, `tables.md` (Reading Tables in Test Cases)
- `ai/docs/psibase/testing.md`
- `rust/CMakeLists.txt` for CTest targets that run `cargo psibase test`
