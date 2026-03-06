# Skill: chain-launch

**Name:** chain-launch  
**When to load:** Story involves launching a local node, booting a chain, or verifying that a UI is serveable from the chain (minimal integration test).  
**Prerequisites:** Repo build producing psinode (see build-system); package with service(s) and optional UI data to install.

---

## Core Knowledge

- **psinode** is the single server process: it serves UIs, routes HTTP/GraphQL by subdomain, and runs services. Use the binary from the repo build (e.g. `build/psinode`) or the official SDK — do not use `cargo install psinode` from crates.io (placeholder).
- **Subdomains:** The node is configured with a base host (e.g. `psibase.localhost`). Each service is reached at **&lt;service-name&gt;.&lt;base-host&gt;** (e.g. `tokens.psibase.localhost`). The service name comes from the package’s service/server (e.g. `package.metadata.psibase` `server` or `services`).
- **Minimal integration bar:** Any UI shipped with a package must be **serveable from the chain** — i.e. after install, HTTP GET to the relevant path(s) on the service subdomain returns success and expected content (e.g. HTML/JS). This applies to any **default/initial state** of a page (primary page, subpages, any URL) with no user interaction assumed. No browser automation or proxy required for this minimum.

Refs: `programs/psinode/config.in`, `ai/docs/psibase/ui-development.md`, `ai/docs/psibase/architecture.md`.

---

## Skill: launch-local-node

1. Ensure psinode is built (full-repo baseline from build-system, or at least the psinode target).
2. Use a **dedicated config** for tests: e.g. copy or adapt `programs/psinode/config.in` with `host = psibase.localhost` (or `psibase.127.0.0.1.sslip.io`), `listen = 8080`, and a **dedicated datadir** (e.g. a temp directory or `./test_node_data`) so test runs don’t clash with dev data.
3. Start psinode in the background: `psinode -c /path/to/test_config` (or equivalent; see repo/SDK for exact CLI). Ensure the process is stopped after tests (script trap or test harness teardown).
4. Wait until the node is ready (e.g. poll `http://127.0.0.1:8080` or a health endpoint, or sleep briefly). If the node fails to start, fail the test and report.

---

## Skill: boot-chain-for-testing

1. With psinode **already running** and listening (e.g. on 8080), install the package(s) under test: from the **package root** (where `[package.metadata.psibase]` with `package-name` and services is), run `cargo psibase install`. This deploys services and uploads UI data (e.g. `data = [{ src = "../ui/dist", dst = "/" }]`).
2. If the package or its docs require specific accounts or postinstall actions, run those (e.g. create accounts, call init). Prefer making the sequence **idempotent** where possible (e.g. “create account if missing”).
3. Do **not** rely on `psibase::test_case` for this path; that is in-process simulated chain. Here we use a real local node for serveability checks.

---

## Skill: verify-ui-serveable

1. After **launch-local-node** and **boot-chain-for-testing**, the UI (if any) is served from the service subdomain. No proxy or browser is required for the minimum test.
2. **curl** the path(s) you need to verify. Test any URL that is the **default/initial state** of a page—e.g. the app’s primary page, subpages, or any path—with **no user interaction** assumed (initially-served content only; no backend data that depends on prior user actions).  
   - Without resolving the subdomain in DNS, use the `Host` header:  
     `curl -sS -o /dev/null -w "%{http_code}" -H "Host: <service>.psibase.localhost" http://127.0.0.1:8080/<path>`  
   - Replace `<service>` with the actual service name (e.g. `tokens`, `r-tokens` — use the server name that serves the UI from the package metadata). Use `<path>` as `/` for the root or the specific route (e.g. `/settings`, `/items`).
3. **Assert:** HTTP status is 200 (or 304 if cached). Optionally, fetch the body and assert that it contains expected content (e.g. `<!DOCTYPE html>`, or a known title/script tag from the app). That confirms the chain is serving the built UI in its initial state.
4. If the package has multiple services with UIs, repeat for each relevant subdomain and path. If a package has no UI, you can still verify the service responds (e.g. `/graphql` or `/graphiql.html` returns 200).

Example (shell):

```bash
# After node is up and package installed
status=$(curl -sS -o /tmp/body -w "%{http_code}" -H "Host: tokens.psibase.localhost" http://127.0.0.1:8080/)
test "$status" = "200" || { echo "Expected 200, got $status"; exit 1; }
grep -q "<!DOCTYPE html>" /tmp/body || { echo "Expected HTML"; exit 1; }
```

---

## Gotchas

- **Datadir:** Use a clean or dedicated datadir for test runs so concurrent dev or other tests don’t corrupt state. Ignore `psinode_db` in `.gitignore` for local runs.
- **Port conflict:** If 8080 is in use, change `listen` in the test config and use the same port in curl.
- **Subdomain name:** The Host header must match how psinode routes: typically `<server>.psibase.localhost` where `server` is the service account name that hosts the UI (from package metadata).

---

## Verification

- psinode starts and stays up for the test; `cargo psibase install` completes without error; curl to the service subdomain returns 200 and response body contains expected UI content (e.g. HTML). That is the minimal “UI is serveable from chain” pass.

---

## Related Skills

- **build-system** — building psinode and packages before launch/install.
- **service-testing** — in-process tests with `psibase::test_case`; use that for logic, use chain-launch for serveability.

---

## References

- `programs/psinode/config.in`
- `ai/docs/psibase/ui-development.md`
- `ai/docs/psibase/testing.md`
- Full UI E2E proposal (future): `ai/docs/psibase/ui-integration-testing-proposal.md`
