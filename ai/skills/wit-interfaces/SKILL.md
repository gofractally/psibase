# Skill: wit-interfaces

**Name:** wit-interfaces  
**When to load:** Story involves WIT for WASM components: defining interfaces, world vs impl, or extending a plugin’s WIT.  
**Prerequisites:** Plugin crate layout (wit/ dir, impl.wit / world.wit); basic WIT syntax.

---

## Core Knowledge

- **WIT** (WebAssembly Interface Type) describes a component’s imports and exports. Plugins are WASM **components**; their WIT defines what they import (host, other plugins) and export (their API).
- **world:** The full component interface (all imports + exports). One of the WIT files is used as the “world” at build time (often `impl.wit` or `world.wit`). The build (e.g. cargo-component) uses this to generate bindings and the component binary.
- **impl.wit vs world.wit:** Projects differ: some have a single `impl.wit` that both defines and implements the world; others have `world.wit` (interface) and `impl.wit` (implementation that includes deps and exports). **Always confirm which file is the component world** for the build; editing the wrong file causes wrong imports/exports.
- **Package names:** WIT uses `package:interface` (e.g. `host:common`, `invite:plugin`). Import paths like `host:common/imports` refer to a specific world or interface; names must match what the dependency exports.

Refs: `ai/docs/psibase/plugins.md`, `ai/docs/psibase/gotchas.md`, Component Model / WIT specs.

---

## Skill: define-interface

1. In the plugin’s WIT file (the one that defines the world or the interface you’re extending), declare an **interface** with function signatures, e.g.  
   `interface inviter { do-thing: func(x: string) -> result<u32, error>; }`
2. Export it in the world: `export inviter;` (or `export package:interface` if namespaced).
3. In Rust, implement the generated `Guest` trait for that interface (e.g. `impl invite::plugin::inviter::Guest for MyPlugin`).

Types (string, u32, result, option, records) must match what the bindings expect. Use the same error type as other interfaces in the project if they’re composed.

---

## Skill: world-vs-impl

- **Identify the world file:** Check the plugin’s build (e.g. cargo-component config, or `wit/` directory). The file that is passed as “world” or “root” is the one that defines the component’s imports and exports. All new imports/exports must be in that file (or included by it).
- **impl.wit** often: includes dependencies (`include host:common/imports; include other:plugin/imports`) and exports the plugin’s interfaces (`export inviter; export invitee;`). So “impl” here means “implementation of the world” (the actual component), not “implementation of Rust”.
- **world.wit** in some projects: defines only the world’s shape (imports/exports); another file might merge in dependencies. If you add an import or export, add it to the file that is actually used as the world at build time; otherwise the component won’t see it.

---

## Skill: extend-wit

- **New export:** Add the interface (or extend an existing one) in the world/impl WIT, then implement the corresponding trait in Rust.
- **New import:** Add `include dep:package/imports` or `import dep:package/interface` in the world WIT. Then add the dependency in Cargo.toml and use the generated Rust bindings (see **plugin-dependencies**). The “extend” is the WIT side of the three-place dependency rule.
- **New type/record:** Define records or enums in WIT where needed; they become Rust types in the bindings. Keep naming consistent with existing WIT in the repo (e.g. `error`, `post-request`, `body-types` in host types).

---

## Gotchas

- **world vs impl:** Editing the non-world file won’t change the component’s interface. Confirm which file the build uses.
- **Package/interface names:** Must match exactly what the other side exports (e.g. `host:common` vs `host:common/imports`). Copy from working plugins.
- **Three-place rule:** Any new plugin dependency = WIT + Cargo + Rust; see **plugin-dependencies**.

---

## Verification

- `cargo component build` succeeds. Generated bindings (in `target/` or the bindings crate) should reflect the new interface. Runtime: call the new export from the UI or another plugin and confirm no missing-import errors.

---

## Related Skills

- **plugin-wasm** — implementing the interfaces in Rust; wire-wit, add-function.
- **plugin-dependencies** — adding a dependency (WIT is one of the three places).

---

## References

- `ai/docs/psibase/plugins.md`, `ai/docs/psibase/gotchas.md`
- Example WIT: `packages/user/Invite/plugin/wit/impl.wit`, `packages/user/Host/plugin/common/wit/world.wit`, `impl.wit`
