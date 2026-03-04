# Skill: ui-supervisor-integration

**Name:** ui-supervisor-integration  
**When to load:** Story involves the UI talking to plugins via the Supervisor: calling plugin functions, preloading plugins, or handling transaction submission.  
**Prerequisites:** UI app (React/TypeScript typical); plugin(s) that export the functions to call. Optional: plugin-wasm for plugin-side changes.

---

## Core Knowledge

- **Flow:** UI does not pack or submit transactions directly in the typical flow. UI → **Supervisor** → **plugin** → plugin adds actions → Supervisor submits the transaction. Reads (queries) can be direct HTTP/GraphQL to the service or via a plugin (e.g. `host:common` `post-graphql-get-json`).
- **Supervisor** runs in a hidden iframe (sibling origin). The app loads the Supervisor and uses the platform JS library (e.g. `@psibase/common-lib`) to make qualified plugin calls: app name + plugin name + function + args.
- **Preloading:** Specify which plugins to preload so the first user action doesn’t wait on plugin download. Implementation is project-specific (Supervisor API / loader).
- **Common endpoints:** `/common/chainid`, `/common/tapos/head`, `/common/thisservice`, `/common/rootdomain`, `/common/pack/Transaction`, etc. — see `doc/src/development/front-ends/reference/http-requests.md`.

Refs: `doc/src/specifications/app-architecture/supervisor.md`, `ai/docs/psibase/ui-development.md`, `ai/docs/psibase/architecture.md`.

---

## Skill: call-plugin

1. Resolve the Supervisor (or the app’s wrapper around it) for the current origin. Use the project’s standard way to get the Supervisor client (e.g. from `@psibase/common-lib` or a local supervisor loader).
2. Invoke the plugin function with **qualified** call: app name (service account), plugin name (e.g. `"plugin"`), function name, and arguments (JSON or the format the API expects).
3. Handle the async result: success payload, or error (e.g. user rejected prompt, network error). Do not assume the call succeeds; surface errors in the UI.

Example (conceptual): the library typically exposes something like `supervisor.call(app, plugin, method, args)` returning a Promise. Exact API depends on the repo (see `packages/user/Supervisor/ui/src/supervisor.ts`, `component-loading/loader.ts`).

---

## Skill: preload-plugins

- **Where:** Configuration or initialization that tells the Supervisor which plugins to load before the first user call. Often a list of (app, plugin) pairs.
- **Why:** Avoid first-click latency while the plugin and its dependency tree are fetched and instantiated.
- **How:** Project-specific. Check the Supervisor/loader API (e.g. `preload(plugins: QualifiedPluginId[])` or similar). System plugins may be preloaded by default; add your app’s plugin(s) to the preload list used when your app loads.

---

## Skill: handle-transactions

- **Submission:** Normally the UI does not build raw transactions. It calls a plugin; the plugin adds actions via `transact:plugin` and the Supervisor submits. The UI only needs to call the plugin and handle success/failure (e.g. redirect, toast, error message).
- **Custom flows:** If the UI must build or sign transactions without a plugin (e.g. raw pack + sign), use `/common/pack/Transaction`, `/common/pack/SignedTransaction`, and the signing libraries documented in the HTTP reference. Escalate such requirements; they are less common and security-sensitive.

---

## Gotchas

- **Origin/embedder:** The Supervisor runs in a different origin (iframe). The app’s origin determines which service domain is “current”; the Supervisor uses this for plugin resolution and requests.
- **Errors:** Plugin calls can fail for many reasons (network, user reject, plugin throw). Always handle errors and avoid assuming success.

---

## Verification

- In the browser, trigger the UI path that calls the plugin; confirm the plugin runs and the transaction is submitted (or the query returns). Check for missing-plugin or CORS/origin errors in the console.

---

## Related Skills

- **plugin-wasm** — plugin functions the UI calls.
- **plugin-dependencies** — if the plugin’s dependencies affect load or call behavior.

---

## References

- `doc/src/development/front-ends/README.md`, `reference/http-requests.md`
- `doc/src/specifications/app-architecture/supervisor.md`
- `ai/docs/psibase/ui-development.md`
- `packages/user/Supervisor/ui/src/supervisor.ts`, `component-loading/loader.ts`
