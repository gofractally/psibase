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
# from packages/user/Chat
cargo-psibase package
cargo-psibase test   # in service/
```

Query GraphiQL is available on the `chat` subdomain at `/graphiql` when the
package is installed.
