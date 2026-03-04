# Skill: service-actions

**Name:** service-actions  
**When to load:** Story involves on-chain actions: adding or changing service actions, pre-action hooks, or calls between services.  
**Prerequisites:** Rust service exists; optionally service-tables if actions touch tables.

---

## Core Knowledge

- **Actions** are `#[action]` functions inside `#[psibase::service] mod service { ... }`. They can read/write tables, call other services, and are invoked by users or other services. Execution is deterministic (no HTTP, no nondeterministic time/random).
- **Context:** `get_sender()` and `get_service()` give caller and current service account. Use `psibase::check(condition, "message")` for assertions.
- **Cross-service calls:** `other_crate::Wrapper::call().action_name(args).get()` — synchronous. By default **recursion is forbidden** (A→B→A). Opt-in with `#[psibase::service(recursive = true)]` is risky; prefer one-way call graphs.
- **Pre-action:** A function marked `#[pre_action(exclude(init))]` runs before every action except those in `exclude`; use for “service must be initialized” checks.

Refs: `doc/src/development/services/rust-service/calling.md`, `doc/src/development/services/rust-service/pre-action.md`, `ai/docs/psibase/rust-services.md`.

---

## Skill: add-action

1. In the `#[psibase::service] mod service` block, add a function with `#[action]`.
2. Use `get_sender()` / `get_service()` if you need caller context. Use `check(...)` for auth or validation.
3. If the action reads/writes tables, open the table with `TableName::new()` and use the appropriate index (e.g. `get_index_pk()`, `get_index_by_from()`).
4. For JS-friendly names you can add `#[allow(non_snake_case)]` on the mod and use PascalCase action names in the API.

Example:

```rust
#[action]
fn storeMessage(to: AccountNumber, content: String) -> u64 {
    let id = get_next_message_id();
    MessageTable::new().put(&Message { id, from: get_sender(), to, content }).unwrap();
    id
}
```

---

## Skill: add-pre-action

1. Define a function that checks the condition you need (e.g. “service initialized” by reading an init table).
2. Add `#[pre_action(exclude(init))]` so it runs before every action except those listed (e.g. `init`).
3. Use `psibase::check(condition, "message")`; if it fails, the action is not run.

Example (see `doc/src/development/services/rust-service/pre-action.md`):

```rust
#[pre_action(exclude(init))]
fn check_init() {
    let table = InitTable::new();
    check(table.get_index_pk().get(&()).is_some(), "service not initialized");
}
```

---

## Skill: call-other-service

1. Add the other service crate as a dependency in Cargo.toml (the other service must be a **library**).
2. Call synchronously: `other_service::Wrapper::call().action_name(arg1, arg2).get()?` (or `.get()` and handle `Result`). The call runs in the same transaction; the other service’s state changes are visible.
3. Do **not** create call cycles (A→B→A) unless the callee has `#[psibase::service(recursive = true)]` and the design has been thought through (re-entrancy, inconsistent state). Prefer one-way flows.

Example:

```rust
// In arithmetic2 calling arithmetic
arithmetic::Wrapper::call().add(a * b, c * d)
```

---

## Gotchas

- **Recursion:** Disallowed by default. Enabling it can lead to inconsistent state (e.g. A writes, calls B, B calls A while A is mid-write). Escalate if the story requires recursive calls.
- **Determinism:** No HTTP, no system time, no random in actions. Use only host APIs documented for services.
- **Library:** Services are libs (`lib.rs`); other services that call this one depend on this crate as a library so they get `Wrapper` and types.

---

## Verification

- `cargo psibase test` with `#[psibase::test_case(packages("PackageName"))]`; use `Wrapper::push(&chain).action_name(args).get()?` or `Wrapper::push_from(&chain, account!("alice")).action_name(args).get()?`. Use `chain.start_block()` between transactions to avoid duplicate rejection.

---

## Related Skills

- **service-tables** — actions that read/write tables.
- **service-graphql** — HTTP/GraphQL handlers (serveSys) that may call internal helpers.
- **service-testing** — testing actions.

---

## References

- `doc/src/development/services/rust-service/calling.md`, `pre-action.md`
- `ai/docs/psibase/rust-services.md`, `ai/docs/psibase/gotchas.md`
