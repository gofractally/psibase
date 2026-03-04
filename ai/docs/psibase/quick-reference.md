# Quick Reference

> Cheat sheet for common operations. See the full docs in this directory for details.

## Rust service (minimal)

```bash
cargo new --lib myservice && cd myservice
cargo add psibase
cargo add -F derive serde
```

```toml
# Cargo.toml
[package.metadata.psibase]
package-name = "MyService"
server = "myservice"
```

```rust
// src/lib.rs
#[psibase::service]
mod service {
    use psibase::*;
    #[action]
    fn add(a: i32, b: i32) -> i32 { a + b }
    #[action]
    fn serveSys(req: HttpRequest) -> Option<HttpReply> {
        serve_simple_ui::<Wrapper>(&req)
    }
}
```

- **Build & install**: `cargo psibase install`
- **Test**: `cargo psibase test` with `#[psibase::test_case(packages("MyService"))]`

## Tables (snippet)

```rust
#[psibase::service_tables]
mod tables {
    use psibase::{AccountNumber, Fracpack, ToSchema};
    use serde::{Deserialize, Serialize};
    #[table(name = "MessageTable", index = 0)]
    #[derive(Fracpack, Serialize, Deserialize, ToSchema)]
    pub struct Message {
        #[primary_key]
        pub id: u64,
        pub from: AccountNumber,
        pub to: AccountNumber,
        pub content: String,
    }
}
// In service: MessageTable::new().get_index_pk().range(begin..end).collect()
```

## GraphQL (snippet)

```rust
// In serveSys:
None.or_else(|| serve_simple_ui::<Wrapper>(&request))
    .or_else(|| serve_graphql(&request, Query))
    .or_else(|| serve_graphiql(&request))
// Query: async_graphql::Object with async fn fields; use TableQuery for pagination
```

## Calling another service

```rust
other_crate::Wrapper::call().action_name(args).get()
```

## Plugin dependency (three places)

1. **Cargo.toml**: `other-plugin = { path = "..." }`
2. **WIT**: `include other:plugin/imports` (or import the right interface)
3. **Rust**: `use other::plugin::api::*` (or the generated bindings)

## Account name rules

- Length 0–18; chars `a-z`, `0-9`, `-`; start with letter; no trailing `-`; no leading `-` or `x-` for DNS.

## Useful paths (repo)

| What | Where |
|------|--------|
| App architecture | `doc/src/specifications/app-architecture/` |
| Rust service docs | `doc/src/development/services/rust-service/` |
| Front-ends / HTTP | `doc/src/development/front-ends/` |
| Fracpack / accounts | `doc/src/specifications/data-formats/` |
| Example plugins | `packages/user/Host/plugin/`, `packages/user/Invite/plugin/` |
| Supervisor UI | `packages/user/Supervisor/ui/` |
| User packages Cargo | `packages/user/Cargo.toml` |
| User packages CMake | `packages/user/CMakeLists.txt` |

## Commands

| Task | Command |
|------|--------|
| Install Rust target | `rustup target add wasm32-wasip1` |
| Install tooling | `cargo install cargo-psibase` |
| Build & deploy package | `cargo psibase install` |
| Run service tests | `cargo psibase test` |
| Build plugin (in plugin crate) | `cargo component build` |
