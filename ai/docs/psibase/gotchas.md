# Gotchas and Pitfalls

> Psibase-specific and WASM/plugin quirks that often cause bugs or confusion. When in doubt, escalate to the user.

## Services (Rust)

- **Table/index stability**: Do not renumber tables, renumber secondary keys, change key types, or remove keys/tables. Adding new `Option<...>` fields only at the **end** of a struct is allowed. Anything else can corrupt or misread data.
- **Secondary index backfill**: New secondary indexes only get entries for **new** puts. Existing rows are not rescanned. Plan a migration (e.g. re-put rows) if you need existing data indexed.
- **Recursion**: Services cannot call back into themselves (or cycles) unless `#[psibase::service(recursive = true)]`. Recursion is easy to misuse (inconsistent state, re-entrancy); prefer one-way call graphs.
- **Determinism**: No HTTP, no non-deterministic time/random in actions. Use host APIs only as documented for services.
- **Library vs binary**: Services are **libraries** (`lib.rs`); the crate must be a library for `Wrapper` and `cargo-psibase` to work. Other services that call this one depend on this crate as a library.

## Plugins (WASM components)

- **Three-place dependency**: Adding a plugin dependency requires **Cargo.toml** + **WIT** (include/import the other plugin) + **Rust** (use the bindings). Missing any one causes broken builds or missing imports at runtime.
- **world.wit vs impl.wit**: Different projects use different conventions for which file is the “world” for the component. Confirm which WIT the build uses; mismatches cause wrong imports/exports.
- **Import names**: WIT package/interface names must match what the dependency exports (e.g. `host:common` vs `host:common/imports`). Copy from a working plugin when adding a host or app dependency.
- **Plugin storage**: Client storage is often backed by LocalStorage (browser), with a shared quota for the supervisor domain. Don’t assume unlimited client storage.

## Build / tooling

- **cargo install psibase / psinode / psitest**: These crates on crates.io are placeholders. Use the executables from the repo build or the official SDK; uninstall the placeholders if you installed them.
- **wasm32-wasip1**: Rust services target `wasm32-wasip1`. Plugins may use `wasm32-unknown-unknown` or another target depending on the component toolchain; check the plugin’s Cargo.toml and CI.
- **cargo-psibase**: Keep it updated; it’s under active development.

## Account names

- **Rules**: 0–18 chars; `a-z`, `0-9`, `-`; must start with a letter; hyphen not last; for DNS, hyphen not first and not `x-` prefix. Invalid names fail at parse or use.

## Fracpack / serialization

- **Unit type**: Fracpack encodes `()` as empty tuple; serde_json often uses `null`. Can cause mismatches when crossing JSON and fracpack.
- **New fields**: Only optional fields at the **end** of structs are safe to add for compatibility.

## When to escalate (AI)

- Changing table schema in a way that isn’t “add optional at end” (migration strategy).
- Enabling or designing recursive service calls.
- Adding or changing plugin dependency graphs (three-place consistency).
- Build failures that persist after checking WIT/Cargo/imports and target.
- Account name or encoding edge cases (e.g. custom validation).
- Any security-sensitive change (auth, signing, authorization).

## References

- Tables: `doc/src/development/services/rust-service/tables.md` (Modifying Tables And Indexes)
- Calling: `doc/src/development/services/rust-service/calling.md` (Recursion Safety)
- Plugins: `ai/docs/psibase/plugins.md` (Adding a plugin dependency)
- Fracpack: `doc/src/specifications/data-formats/fracpack.md`
- Account numbers: `doc/src/specifications/data-formats/account-numbers.md`
