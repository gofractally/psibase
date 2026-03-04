# Plugins (WASM Components)

> AI-focused summary. Official spec: `doc/src/specifications/app-architecture/plugins.md`, Supervisor: `supervisor.md`.

## What a plugin is

A **plugin** is a **WebAssembly component** (WIT-defined interface) that runs in the **browser** inside the **Supervisor**. It does not run on the chain. It:

- Exports functions the UI (or other plugins) call.
- Imports host-provided interfaces (e.g. `host:common`, `host:db`, `transact:plugin`, `accounts:plugin`).
- Can add actions to transactions, call back to its service (GraphQL/HTTP), use client storage, and call other plugins synchronously.

Plugins are **capability-based**: they only see what their WIT imports/exports declare.

## Anatomy

- **Artifact**: Built with `cargo component build` (or equivalent); output is a `.wasm` component. Stored in the service and served as `/plugin.wasm` (or similar).
- **WIT**: Defines the plugin’s **world** (imports + exports). Two files matter:
  - **world.wit** (or equivalent): describes the **world** (imports from host/other plugins, exports from this plugin). Some projects use a single `impl.wit` that both defines and implements.
  - **impl.wit**: Often used as the “implementation” world that includes dependencies and exports the plugin’s interfaces. **Gotcha**: `world.wit` vs `impl.wit` naming and which file is the “world” can vary by project; always confirm which WIT is used as the component’s world at build time.
- **Rust**: Implements the exported interfaces (e.g. `impl Inviter for InvitePlugin`). Bindings are generated from WIT (e.g. `wit_bindgen::generate!` or cargo-component).

## Adding a plugin dependency (critical for AI)

When plugin A wants to call plugin B, you must update **three** places or the build/runtime will break:

1. **Cargo.toml**: Add the dependency (e.g. `other-plugin = { path = "../Other/plugin" }`).
2. **WIT**: In the plugin’s world/impl WIT, add the dependency (e.g. `include other:plugin/imports` or `import other:plugin/api`) and re-export or use as needed.
3. **Rust**: Import and use the bindings (e.g. `use other::plugin::api::*`). Ensure the WIT package/interface names match what the other plugin exports.

If any of the three is missing, you get missing imports or link errors.

## Host interfaces (typical)

- **host:common**: `server` (post-graphql-get-json, post, get-json), `client` (get-sender, get-receiver, get-app-url, get-active-app), `admin` (post, post-with-credentials). Requests are to the **caller app’s** service only.
- **host:db**: Key/value client storage (session/persistent, transactional or not). Namespaced by chain, app, and optionally user.
- **host:prompt**: User prompts (e.g. confirmation).
- **host:auth**: Auth tokens for queries.
- **transact:plugin**: Add actions to the current transaction, submit.
- **accounts:plugin**: Current user, etc.

Exact interfaces: see `packages/user/Host/plugin/*/wit/` and Supervisor/docs.

## Supervisor flow

1. UI asks Supervisor to call a plugin function.
2. Supervisor fetches plugin (and its dependency tree), generates JS glue, transpiles component to core WASM, bundles, initializes.
3. Plugin runs; can add actions via `transact:plugin`, call other plugins, use host APIs.
4. Supervisor submits the transaction (FIFO order of actions added).

## Building

- From a service package that declares `plugin = "crate-name"`: `cargo psibase build` (or install) builds the plugin with `cargo component` and includes it in the package.
- Standalone: in the plugin crate, `cargo component build --target wasm32-unknown-unknown` (or the target your project uses). Ensure WIT path and world name match.

## References

- Plugins spec: `doc/src/specifications/app-architecture/plugins.md`
- Supervisor: `doc/src/specifications/app-architecture/supervisor.md`
- Example plugins: `packages/user/Host/plugin/common`, `packages/user/Invite/plugin`, `packages/user/ClientData/plugin`
