# App UI regression

This gate builds every current web app, runs the existing UI logic tests, and
opens production bundles in Chromium. It includes Exchange, Tokens, Favor and
BTC Bridge, which are standalone projects outside `packages`' Yarn workspace,
and the static ETH Bridge app.
The GitHub `App UI regression` workflow runs it on pull requests and pushes to
`bytemaster/head`, `main`, and release branches.

## Run

Prerequisites: Node 22 (`.nvmrc`), Corepack, Rust with `wasm32-wasip1`, and
`cargo-component` 0.21.1. The latter builds XAdmin's browser WASM helper.

From the repository root:

```sh
corepack enable
rustup target add wasm32-wasip1
cargo install cargo-component --locked --version 0.21.1
node tests/ui/run.mjs --install
```

On Linux install Chromium's system libraries once with
`cd tests/ui && npm ci && npx playwright install-deps chromium`.

After dependencies are installed, `node tests/ui/run.mjs` repeats all builds
and tests. It forces fresh builds rather than trusting the UI hash cache.
For a quick browser iteration against already-built bundles:

```sh
cd tests/ui
npm test
npm test -- exchange.spec.mjs
```

`node tests/ui/run.mjs --skip-build` runs all tests against existing bundles;
CI rejects that option. Set `PSIBASE_UI_TEST_PORT` to use another free port.
The default is 4179. Each run starts and stops its own loopback-only server.

## Evidence

- `build-app-regression/ui/results.json`: revision, commands, timing and status.
- `build-app-regression/ui/*.log`: build and unit-test output.
- `tests/ui/playwright-report/index.html`: browser report (`npm run report`).
- `tests/ui/test-results/`: machine-readable results and failure traces/screenshots.

CI uploads these artifacts even when a gate fails. Traces and screenshots are
retained only for failures. Fixtures contain disposable sample identities and
no usable wallet keys.

CI also compiles the Exchange, Tokens, Favor, BTC Bridge, BTC Relay and ETH
Bridge WASM plugins against the current native interfaces. This catches stale
WIT imports that frontend RPC fixtures cannot detect. It uses WASI SDK 24 for
C dependencies and records output in `plugin-build.log`.

## What the tests prove

The browser suite exercises built production HTML, JavaScript, forms and
navigation. It checks reviewed amounts and native RPC parameters, approval and
trust choices, privacy on account switching, and error handling. Shared React
apps use the actual Common API postMessage client with a fixture Supervisor
iframe. Exchange and Tokens replace the native Common API module boundary.
Favor covers both its local sample ledger and its production API adapter.

The network fixture blocks requests outside the test server's loopback port
and blocks WebSockets. Unexpected native calls fail the scenarios. Tests must
import `test` and `expect` from `./test.mjs` to inherit that isolation.

These are browser contract tests, not signed chain integration tests. They do
not execute native service WASM, create real accounts, sign transactions, move
funds, or prove actual cross-origin cookie/permission behavior. Native contract
tests and a disposable full-chain run remain separate gates; neither a browser
fixture nor a successful frontend build substitutes for those gates.

## Extending coverage

Add a scenario to an existing `*.spec.mjs` or create another file importing
`./test.mjs`. Use production bundles and explicit native/service fixtures;
assert the final UI and submitted request, and reject unknown calls. Add new
standalone builds and logic tests to `run.mjs`, and add their dist directory to
`server.mjs`. Keep real network access and persistent developer chains out of
the suite.
