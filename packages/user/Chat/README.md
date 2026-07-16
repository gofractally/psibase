# Chat (`packages/user/Chat`)

Objective on-chain Chat service: Spaces (DM and group), WebRTC session metadata,
and call timeline events. Message bodies are peer-to-peer over WebRTC data
channels (Homepage UI); this package owns durable objective state and the plugin
API used by the UI.

## Layout

| Path | Purpose |
| --- | --- |
| `service/` | Objective actions: spaces, sessions, timeline |
| `query-service/` | Authenticated GraphQL (`mySpaces`, `activeSession`, `callEvents`, …) |
| `plugin/` | Supervisor-facing API (`ensure-dm`, `create-session`, …) |
| `src/` | Package entry / C++ bindings surface |

UI for Chat lives under Homepage at
`packages/user/Homepage/ui/src/apps/chat` (route `/chat`), not in this package.

## Build / test

```bash
# Prefer nix develop so rustc/cargo are on PATH.
# If cargo-component fails with EXDEV (cross-device link), put --target-dir on
# the same filesystem as the process temp dir (often /tmp/...):
cargo-psibase test \
  --manifest-path packages/user/Chat/service/Cargo.toml \
  --target-dir /tmp/psibase-chat-target \
  --psitest=build/psitest
```

Registered in default `ctest` as `rs-test-Chat` (see
`add_usr_cargo_psibase_test(Chat)` in `packages/CMakeLists.txt`, alongside
Identity/Tokens/etc.).

Query GraphiQL is available on the `chat` subdomain at `/graphiql` when the
package is installed.
