# UI Development

> AI-focused summary. Official: `doc/src/development/front-ends/`.

## Stack and hosting

- **Typical stack**: React, TypeScript, TailwindCSS, shadcn, TanStack React Query / React Form. UIs are static assets (or SSR if you add it) **stored in the service database** and **served from the service subdomain** (e.g. `my-app.psibase.localhost`).
- **No separate web server**: The service (or http-server) serves the UI; psinode routes by domain/path.

## How the UI talks to the chain

1. **Reads (queries)**  
   - **GraphQL**: POST to `/graphql` on the service domain (or use a plugin that calls `host:common` `post-graphql-get-json`).  
   - **REST/GET**: Any GET or custom endpoint the service exposes in `serveSys` (or via http-server registration).

2. **Writes (transactions)**  
   - UI does **not** pack transactions itself in the typical flow.  
   - UI calls the **Supervisor** to invoke a **plugin** function.  
   - The plugin adds actions (and optionally signs) and the Supervisor submits the transaction.  
   - So: **UI → Supervisor → plugin → transaction**.

## Supervisor integration

- The app loads the Supervisor (e.g. from a sibling origin in an iframe). The Supervisor is the single entry point for plugin calls and transaction submission.
- **Preloading**: Specify which plugins to preload so the first user action doesn’t wait on plugin fetch.
- **Call pattern**: Use the platform’s JS library (e.g. `@psibase/common-lib`) to call into the Supervisor with a qualified plugin call (app + plugin name + function + args). The Supervisor loads the plugin if needed, runs it, collects actions, and submits.

Example entry points: `packages/user/Supervisor/ui/src/supervisor.ts` (Supervisor class), `packages/user/Supervisor/ui/src/component-loading/loader.ts`.

## Plugin calls from the UI

- Resolve the Supervisor (or its wrapper) for the current origin.
- Invoke a function by **app name**, **plugin name**, **function name**, **arguments** (JSON or packed as required).
- Handle async result and errors (e.g. user rejected prompt, network error).

## Common endpoints (shared across domains)

- `/common/chainid`, `/common/tapos/head`, `/common/thisservice`, `/common/rootdomain`, `/common/pack/Transaction`, `/common/pack/SignedTransaction`, etc. See `doc/src/development/front-ends/reference/http-requests.md`.

## When to escalate (AI)

- Changing how the Supervisor is embedded or how plugins are preloaded (project-specific).
- Custom auth or signing flows beyond the standard plugin + transact flow.
- If the UI must submit transactions without a plugin (e.g. raw packing/signing); then you need the common packing endpoints and signing libraries (see docs).

## References

- Front-ends: `doc/src/development/front-ends/README.md`
- HTTP routing: `doc/src/development/front-ends/reference/http-requests.md`
- Supervisor UI code: `packages/user/Supervisor/ui/`
