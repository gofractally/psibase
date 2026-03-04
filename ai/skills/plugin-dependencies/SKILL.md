# Skill: plugin-dependencies

**Name:** plugin-dependencies  
**When to load:** Story involves adding or changing a plugin’s dependency on another plugin or host interface.  
**Prerequisites:** Plugin crate with WIT and Rust; understanding of WIT package/interface names.

---

## Core Knowledge

- Adding a plugin dependency requires **exactly three** changes. Missing any one causes build failure or missing imports at runtime:
  1. **Cargo.toml** — add the dependency (path or workspace member).
  2. **WIT** — include or import the other package’s interface (e.g. `include other:plugin/imports` or `import other:plugin/api`). Names must match what the dependency exports.
  3. **Rust** — use the generated bindings (e.g. `use other::plugin::api::*` or call `other::plugin::api::function()`).
- **Host** interfaces (e.g. `host:common`, `host:db`, `transact:plugin`) are provided by the Supervisor; they appear as WIT imports. Same three-place rule if you add a new host import: ensure WIT declares it and Rust uses the generated module.
- Copy **exact** package/interface names from a working plugin (e.g. `host:common/imports` vs `host:common`) to avoid subtle mismatches.

Refs: `ai/docs/psibase/plugins.md`, `ai/docs/psibase/gotchas.md`.

---

## Skill: add-dependency

Do all three steps. Order can be 1→2→3 or 2→1→3; all must be done before the build will succeed.

1. **Cargo.toml**  
   In the plugin crate, add the dependency, e.g.  
   `other-plugin = { path = "../OtherApp/plugin" }`  
   or a workspace member. If the dependency is in the same repo, use the path that resolves from this crate’s directory.

2. **WIT**  
   In the plugin’s world/impl WIT file (the one used as the component world at build time):
   - For another app’s plugin: `include other:plugin/imports` (or the exact `package:interface` the other plugin exports; check its WIT).
   - For host: `include host:common/imports`, `include host:db/imports`, `include transact:plugin/imports`, etc. Match the names used in other working plugins (e.g. in `packages/user/Host/plugin/*/wit`, `packages/user/Invite/plugin/wit/impl.wit`).
   - If you need only specific functions, some WITs use `import package:interface;` and then re-export or use in the world. Keep names identical to the dependency’s exports.

3. **Rust**  
   - Add `use other::plugin::api::*` (or the actual generated module path; it mirrors the WIT package/interface).  
   - Call the dependency’s functions where needed.  
   - If the WIT uses a different path (e.g. `imports` vs `api`), the Rust bindings may be under a different module name; check the generated bindings or existing usage in the same crate.

**Verification:** Run `cargo component build` (or `cargo psibase build`). Resolve any “missing import” or “undefined symbol” by re-checking WIT package/interface names and Rust import paths.

---

## Gotchas

- **Three places:** It’s easy to add only Cargo + Rust and forget WIT, or only WIT and forget Rust. Always confirm all three.
- **world.wit vs impl.wit:** The file that defines the component’s world is the one the build uses. If you edit the wrong file, the new import may not appear in the component.
- **Name mismatches:** `host:common` vs `host:common/imports` — use the exact form the dependency exposes. Copy from `packages/user/Invite/plugin/wit/impl.wit` or similar for host and app plugins.

---

## Verification

- `cargo component build` completes. In the browser, a call that uses the new dependency should not show a missing-import or link error. If the dependency is a host interface, the Supervisor provides it; if it’s another app plugin, that plugin must be loaded when the call runs.

---

## Related Skills

- **plugin-wasm** — adding functions that use the new dependency; wire-wit.
- **wit-interfaces** — defining or extending WIT (world vs impl, extend).

---

## References

- `ai/docs/psibase/plugins.md` (Adding a plugin dependency)
- `ai/docs/psibase/gotchas.md` (Three-place dependency, Import names)
- Example: `packages/user/Invite/plugin/wit/impl.wit`, `packages/user/Host/plugin/common/wit/`
