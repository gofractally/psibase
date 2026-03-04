# Skill: plugin-wasm

**Name:** plugin-wasm  
**When to load:** Story involves browser-side WASM plugin logic: adding functions, wiring WIT, or calling Supervisor/host.  
**Prerequisites:** Plugin crate exists (WIT + Rust); see wit-interfaces and plugin-dependencies for WIT and dependency changes.

---

## Core Knowledge

- **Plugins** are WebAssembly **components** (WIT-defined). They run in the **browser** inside the **Supervisor**, not on the chain. They export functions the UI (or other plugins) call and import host interfaces (e.g. `host:common`, `host:db`, `transact:plugin`).
- **Flow:** UI → Supervisor → plugin; plugin can add actions to the current transaction and call back to its service (GraphQL/HTTP via host) or other plugins.
- **Build:** `cargo component build` (or via `cargo psibase build` when the service has `plugin = "crate-name"`). Output is a `.wasm` component.
- Adding a **dependency** on another plugin requires **three** updates: Cargo.toml, WIT (include/import), and Rust (use bindings). See **plugin-dependencies** skill.

Refs: `doc/src/specifications/app-architecture/plugins.md`, `ai/docs/psibase/plugins.md`, `ai/docs/psibase/architecture.md`.

---

## Skill: add-function

1. **WIT:** In the plugin’s world/impl WIT, add the new export to the appropriate interface (e.g. `inviter`, `invitee`). Define the function signature (params and return type) in the interface.
2. **Rust:** Implement the trait that the WIT bindings generate for that interface (e.g. `impl inviter::Guest for MyPlugin`). Add the new method; use existing imports (host, other plugins) as needed.
3. Rebuild with `cargo component build` (or `cargo psibase build`). The UI (or another plugin) can call this function via the Supervisor.

Example (conceptual): if WIT has `export inviter { do-something: func(x: string) -> result<u32, error>; }`, then in Rust implement `fn do_something(&self, x: String) -> Result<u32, Error> { ... }`.

---

## Skill: wire-wit

- **New interface:** Define the interface in WIT (e.g. in `world.wit` or `impl.wit`). Use `export name;` in the world and implement the corresponding `Guest` in Rust.
- **New import:** Add `include other:plugin/imports` or `import other:plugin/api` (exact path depends on the other plugin’s WIT). Then in Rust, use the generated bindings (e.g. `other::plugin::api::function()`). Always update **plugin-dependencies** (Cargo + WIT + Rust) together.
- **world.wit vs impl.wit:** Projects differ on which file is the component “world”. Confirm which file the build uses so imports/exports match; mismatches cause link or runtime errors.

---

## Skill: call-supervisor

- Plugins do not call the Supervisor directly. They use **host** and **transact** interfaces provided by the Supervisor:
  - **host:common** — `server.post_graphql_get_json`, `server.get_json`, `server.post`, `client.get_sender`, `client.get_receiver`, `client.get_app_url`, `client.get_active_app`, etc. Requests go to the **caller app’s** service.
  - **transact:plugin** — add actions to the current transaction, submit.
- In Rust, use the generated bindings (e.g. `host::common::server::post_graphql_get_json(graphql)`). Ensure the plugin’s WIT includes the right host/transact interfaces (e.g. `include host:common/imports`, `include transact:plugin/imports`).

---

## Gotchas

- **Three-place dependency:** Any new plugin dependency = Cargo.toml + WIT + Rust. Missing one breaks build or runtime.
- **world vs impl:** Confirm which WIT file is the component world for the build.
- **Storage:** Client storage (host:db) is often LocalStorage-backed; shared quota per supervisor domain. Don’t assume unlimited size.

---

## Verification

- `cargo component build` (or `cargo psibase build`) succeeds. Deploy and invoke the new function from the UI or test plugin; confirm no missing-import errors in the browser.

---

## Related Skills

- **plugin-dependencies** — adding a dependency (Cargo + WIT + Rust).
- **wit-interfaces** — defining or extending WIT (world vs impl, extend).
- **ui-supervisor-integration** — UI calling this plugin via Supervisor.

---

## References

- `doc/src/specifications/app-architecture/plugins.md`, `supervisor.md`
- `ai/docs/psibase/plugins.md`, `ai/docs/psibase/gotchas.md`
- Example plugins: `packages/user/Host/plugin/common`, `packages/user/Invite/plugin`
