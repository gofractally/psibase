# Rust Services

> AI-focused summary. Full docs: `doc/src/development/services/rust-service/`.

## What a Rust service is

A **Rust service** is a **WASM library** (not a binary): `cargo new --lib`, `src/lib.rs`. It runs in the psibase WASM VM on the server. It defines **actions** (authenticated, can write DB), **HTTP handlers** (e.g. `serveSys` for UI + RPC + GraphQL), and optionally **tables** and **events**.

- **Actions**: `#[action]` functions; callable by users or other services; can read/write tables.
- **Query handlers**: During HTTP handling, services may **read** but not **write** (determinism).
- **Events**: Emitted for history; stored in a prunable event log (see `doc/src/specifications/app-architecture/events.md`).

## Setup (for AI / new projects)

- Rust 1.83+, `wasm32-wasip1`, `cargo-psibase`.
- Do **not** `cargo install psibase psinode psitest`; use the repo-built or SDK executables.

```bash
rustup target add wasm32-wasip1
cargo install cargo-psibase
```

## Tables

- **Macro**: `#[psibase::service_tables]` on a `mod tables { ... }`.
- **Per-table**: `#[table(name = "MessageTable", index = 0)]` on a struct. **Index is stable**: do not renumber tables or keys.
- **Primary key**: `#[primary_key]` on a field or method (e.g. `fn pk(&self) -> u64`).
- **Secondary indexes**: `#[secondary_key(1)]`, `#[secondary_key(2)]`, etc. on **methods** returning a key (e.g. `(AccountNumber, u64)`). New rows get new index entries; existing rows are **not** backfilled—add indexes only for new data or plan a migration.
- **Singletons**: Table with at most one row: primary key method returns `()`.
- **Modifications**: Do **not** change key definitions, renumber indexes, remove keys/tables, or change field types. You may **add** new `Option<...>` fields **at the end** of an existing table.

Types in tables need `Fracpack`, `Serialize`, `Deserialize`, `ToSchema` (and `ToKey` for keys). See `doc/src/development/services/rust-service/tables.md`.

## Actions and HTTP

- **Actions**: `#[action]` in `#[psibase::service] mod service { ... }`. Use `get_sender()`, `get_service()` for context.
- **HTTP**: Typically one `#[action] fn serveSys(request: HttpRequest) -> Option<HttpReply>` that delegates to `serve_simple_ui::<Wrapper>(&request)`, custom routes, and/or `serve_graphql` / `serve_graphiql`.
- **Calling other services**: `other_service::Wrapper::call().action_name(args).get()` (synchronous). Recursion is disallowed by default; opt-in with `#[psibase::service(recursive = true)]` (risky).

## GraphQL

- Use `async-graphql`; psibase provides `serve_graphql(&request, Query)` and `serve_graphiql(&request)`.
- Table-backed pagination: `TableQuery::new(index).first(...).before(...).after(...).query().await` for GraphQL connections. See `doc/src/development/services/rust-service/graphql.md`.

## Pre-action initialization

- `#[pre_action(exclude(init))]` on a function that checks “service initialized”; it runs before every action except those in `exclude`. Use for “init required” guards. Example: `doc/src/development/services/rust-service/pre-action.md`.

## Package metadata (Cargo.toml)

```toml
[package.metadata.psibase]
package-name = "Example"
server = "example"        # crate that handles HTTP (often self)
plugin = "example-plugin" # optional; built with cargo component
data = [{ src = "../ui/dist", dst = "/" }]
postinstall = [{ sender = "...", service = "...", method = "init", rawData = "0000" }]
```

- **Workspace**: Top-level `[package.metadata.psibase]` can set `services = ["s1", "s2"]`; each service crate lists `server`, `plugin`, etc. See `doc/src/development/services/rust-service/package.md`.

## Fracpack and account names

- **Fracpack**: Psibase’s binary format for DB and messages. Use `psibase::Fracpack` and related derives. Optional new fields at end of structs are supported.
- **Account names**: 0–18 chars; `a-z`, `0-9`, `-`; must start with letter; hyphen not last (and not first for DNS). Type: `AccountNumber`. See `doc/src/specifications/data-formats/account-numbers.md`.

## References

- Setup: `doc/src/development/services/rust-service/setup.md`
- Tables: `doc/src/development/services/rust-service/tables.md`
- GraphQL: `doc/src/development/services/rust-service/graphql.md`
- Calling other services: `doc/src/development/services/rust-service/calling.md`
- Pre-action: `doc/src/development/services/rust-service/pre-action.md`
- Package/build: `doc/src/development/services/rust-service/package.md`
- Testing: `doc/src/development/services/rust-service/testing.md`
- Fracpack: `doc/src/specifications/data-formats/fracpack.md`
