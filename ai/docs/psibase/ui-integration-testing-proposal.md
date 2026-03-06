# UI Integration / End-to-End Testing — Proposal (Future)

> **Status:** Proposal for later implementation. Not in scope for the current minimal chain-launch skill. Use this doc when you are ready to add full UI integration testing.

## Goal

Give the AI (and developers) a repeatable pattern to run **end-to-end tests** that cross:

**UI → Supervisor → plugin → service → DB → query (GraphQL/HTTP)**

with a real local node and a real browser (or browser-automation) hitting the UI.

## Why deferred

- **Infra and harness:** Full UI E2E requires a test harness (e.g. Playwright), config, and CI-friendly scripts.
- **Dev server vs chain:** A local UI dev server (Vite, etc.) does **not** share the same origin as the chain. The chain serves UIs from **service subdomains** (e.g. `my-app.psibase.localhost`). So either:
  - Run the UI **from the chain** (build assets, install package, curl or browser hits the subdomain), or
  - Run a **proxy** so the dev server appears on the same host/domain as the chain (e.g. `app.psibase.localhost` → proxy to Vite). That proxy is extra setup and configuration.
- **Scope control:** Implementing launch + boot + “UI serveable from chain” (curl) first establishes the chain lifecycle and the minimum bar (“any UI written must be serveable from chain”) with minimal setup. Full E2E can build on that.

## Proposed scope (when implemented)

### Area skill: `ui-integration-testing`

**Core knowledge**

- psinode is the single server: it serves UIs, routes HTTP/GraphQL, runs services.
- Flow: **UI → Supervisor → plugin → service → tables/events**; UIs can also call GraphQL directly on the service domain.
- Local dev = one node, local DB, dev config.

**Sub-skills**

1. **Skill: launch-local-node**  
   Start psinode with a reproducible dev config (host, port, datadir). Run in background for the test run; document clean startup/shutdown.

2. **Skill: boot-local-chain-for-testing**  
   Use `cargo psibase install` (or snapshot) to deploy packages and create test accounts. Idempotent where possible. Clearly separate from `psibase::test_case` (use for integration, not for every test).

3. **Skill: run-ui-against-local-node**  
   - **Dev mode:** UI dev server (e.g. `pnpm dev`) with config pointing at local psinode. Requires a **proxy** so the app is served from a host that matches the chain’s domain (e.g. same-origin for Supervisor/plugins).
   - **Service-hosted mode:** Build UI assets, install package, UI is served by the service via `serve_simple_ui`. No proxy; fully realistic.

4. **Skill: write-ui-flow-test**  
   Use a browser-automation tool (e.g. **Playwright**). Precondition: node running, chain booted, UI at known URL. Steps: navigate, perform actions, assert on visible results and on-chain state. Keep tests few and focused on critical flows.

**Verification**

- Node starts and produces blocks; install completes; UI loads; flow assertions pass.

**Out of scope (for this proposal)**

- General service-only integration without UI → use `service-testing` + psibase test chain.
- CI pipeline wiring (can be mentioned, not fully specified).
- Multi-node or performance testing.

## References

- `ai/docs/psibase/ui-development.md` — how UIs are hosted and talk to the chain
- `ai/docs/psibase/testing.md` — current testing summary
- `programs/psinode/config.in` — example psinode config (host, listen, etc.)
