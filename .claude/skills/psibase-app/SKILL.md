---
name: psibase-app
description: Build or change a psibase app (an on-chain service, its query service, its browser plugin, and its React UI) so that it follows the project's one pattern. Use when creating a new package under packages/, adding actions, tables, queries, plugin functions or UI screens to an existing one, reviewing such a change, or answering how a call gets from a page to the chain.
---

# Building a psibase app

The pattern is documented for people in two pages. **Read both before writing code**; this file only adds how to work.

- `doc/src/development/apps/README.md`: the four parts, the rules, code for each part, the checklist.
- `doc/src/development/apps/call-flows.md`: how a call travels, the async direction, known limits.

## Copy from these, not from elsewhere

| For | Read |
|---|---|
| A complete Rust app | `packages/user/Fractals/` (service, query-service, plugin, ui) |
| Typed plugin results, trust levels with whitelists, native plugin tests, a C++ mirror header | `packages/user/Tokens/` |
| A C++ service with a Rust plugin | `packages/user/Invite/` |
| A UI that calls only its own plugin, with typed hooks | `packages/user/Homepage/ui/`, `packages/user/Config/ui/` |
| Shared UI code | `packages/shared-ui/` (`lib/plugins`, `lib/graphql/graphql-auth.ts`, `hooks/plugin-function`) |

**Do not model new work on** `Exchange`, `Favor`, `BtcBridge`, `EthBridge`, `Signing`, `Tokens/ui`, `Evaluations/plugin`, or `package-templates/basic-01`. They predate or depart from the pattern (JSON-text plugin functions, REST query services, stand-alone UI builds, the older trust macros). The same goes for any plugin that uses `define_trust!` or calls `add_action_to_transaction` directly.

Some pages of the book are out of date: anything showing `#[derive(Pack, Unpack, ToSchema)]` or the word fracpack describes removed code. Use the `psio::` derives shown in the guide.

## The rules, in one place

1. State changes only through service actions. Query services never write. UIs never build transactions.
2. A UI calls only its own plugin. It never calls another app's plugin and never fetches another service's address.
3. Logic lives in the plugin; the UI is the view.
4. Plugins keep nothing in memory between calls. One call is one transaction. Calls do not overlap.
5. Plugin code is written as straight-line synchronous calls. Do not add `async` to plugin Rust or WIT.
6. Every exported plugin function has `#[psibase_plugin::authorized(Level)]`, and its capability is described in `TrustConfig` in words a user would recognise.
7. Plugin functions take and return typed values. Account names and decimal amounts are strings. No JSON text, except `authorized.graphql`.
8. Reads are served by a GraphQL query service on the `<service>+1` account. Lists are connections. Every query is bounded.
9. A private query checks only that the request's user is the user asked about. What another app may learn is decided by the owning app's plugin, which returns the least that serves.
10. A hand-written mirror of a service interface (Rust under `rust/psibase/src/services/`, C++ under `include/services/`) is always added together with its schema test (`verify_schema`, `CHECK_SCHEMA`).

## How to work

**Before writing.** Say which of the four parts the change touches and why. A new piece of state needs all four: table and action, a query, a plugin function, a screen. Decide the trust level of each new plugin function and say what the user would be told.

**Order.** Service and tables, then the query service, then the plugin (WIT first, then Rust), then the UI. Each layer depends only on the ones before it.

**New package.** Create the layout in the guide, then register it in three places: `packages/user/Cargo.toml` (each crate), `packages/package.json` (the UI), and the root `CMakeLists.txt` (`cargo_psibase_package`, and the package lists that should include it).

**Changing a deployed service.** Never renumber a table, reorder its keys, or change a stored record's layout without a migration action. Ask before changing an action's signature: every mirror, plugin and UI that uses it changes with it.

**Using another app.** Import its plugin in your plugin's `impl.wit` and `Cargo.toml`, call it from your plugin, and return a typed result of your own. Expect a permission prompt the first time, which abandons the call; the UI must make repeating the action natural.

**When the pattern does not cover something** (a local development loop for the UI, run-time plugin linking, WebSockets, notifications from the node): say so and ask. Do not invent a mechanism, and do not reach around the plugin with a direct fetch.

## Check your work

- `cargo psibase test` in the package, with a test for each new action, including one that the wrong sender is refused.
- Native `#[cfg(test)]` tests for plugin logic that does not touch the host.
- The UI builds with no type or lint errors (`yarn build` in `ui/`).
- Go through the checklist at the end of the guide and report any item you could not meet, with the reason.
- State what you ran and what you did not. A plugin or UI that was built but never run in a browser has not been tested.
