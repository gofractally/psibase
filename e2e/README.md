# @psibase/e2e

Playwright end-to-end harness for psibase. The base provides Playwright setup
(config, browser projects, CTest and CI wiring, binary and package resolution).
This branch adds Supervisor fixtures and fetch specs on top of that base.

## Prerequisites

Build psibase (or point the environment variables below at an unpacked psidk
tree). Install the browsers for the Playwright version pinned in
`package.json` (`@playwright/test`) once:

```bash
yarn exec playwright install chromium webkit
```

> **NOTE (Nix / NixOS):** skip Playwright’s `install --with-deps` (it expects
> apt/sudo). From the repo root, `nix develop` already sets
> `PLAYWRIGHT_BROWSERS_PATH` to a matching `playwright-driver` and
> `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`. Run tests from that shell; do not run
> `yarn exec playwright install …` unless you intend to override the Nix
> browsers. See `nix/README.md`.

A browser that isn't installed makes its CTest skip (exit code 77) rather than
fail the build.

Optional local SDK fallback used by the Supervisor fixtures (when
`PSINODE_BIN` / `PATH` do not already resolve binaries):

```bash
./scripts/fetch-psidk.sh
```

## Environment variables

When set, paths are relative to the repository root unless absolute. When
unset, `psinode` and `psibase` are resolved from `PATH` (direnv adds
`build/psidk/bin` and `build/rust/release`).

| Variable | Purpose |
| --- | --- |
| `PSINODE_BIN` | psinode binary |
| `PSIBASE_BIN` | psibase CLI binary |
| `PSIBASE_PACKAGES` | optional directory of `.psi` packages (e.g. locally built ones); defaults to `share/psibase/packages` next to the psinode install prefix |
| `E2E_PORT_BASE` | optional; base port for per-worker devnets (default `28080`) |
| `E2E_PSINODE_LOG` | set to `1` to print psinode logs from fixture-booted chains |

The config fails immediately when a configured path is missing, when neither
binary variable is set and the command is absent from `PATH`, or when no
package directory can be found.

## CTest

From the build directory:

```bash
ctest -L e2e            # all e2e tests
ctest -R e2e-chromium   # one browser
ctest -R e2e-webkit
```

Each browser project is its own CTest entry, registered with
`psibase_add_e2e_test(<name> <browser> [playwright args...])` in
`CMakeLists.txt`; extra args can narrow a test to a spec folder. Excluded from
CI container builds via `ctest -LE e2e`; the GitHub Actions `e2e` job installs
Chromium and WebKit and runs the suite on the runner instead.

## Running the suite

From this directory:

```bash
yarn test                      # all projects
yarn test --project=chromium
yarn test specs/supervisor/fetch-sync.spec.ts
./run-ctest.sh webkit [args]   # one browser, as CTest runs it
```

Artifacts (traces, videos, HTML report) are written to `test-results/`.

## What this branch adds

- **Two projects, run in parallel:** `chromium` and `webkit` (WebKit stands in
  for Safari). Versions are pinned by the exact `@playwright/test` version in
  `package.json` (1.64.1). Bump that one version to move browsers (and the Nix
  `playwright-driver` pin in lockstep on NixOS).
- **One isolated chain per browser job.** Each project has one worker
  (`workers: 1` per project). Each worker boots its own devnet in a temp data
  dir: `psinode` on port `E2E_PORT_BASE + 10*parallelIndex` (default 28080 /
  28090) and a proxy on the next port. No ports, data dirs or endpoints are
  shared between jobs. Chains are torn down when the worker exits.
- **Proxy (`fixtures/proxy.ts`)** sits in front of each psinode. The browser
  only talks to the proxy. It forwards everything to psinode and adds
  test-only routes on every subdomain:
  - `/__e2e/harness.html`: a minimal app page that embeds the Supervisor
    iframe and speaks its postMessage protocol (`window.e2e.call`, `preload`).
  - `/__e2e/sleep?ms=N&tag=T`: waits N ms, then returns
    `{tag, ms, start, end}`. Sleep-and-timestamp fixture for proving whether
    fetches overlap or block, with no real network. Every hit is recorded in
    `devnet.proxy.sleeps`.
- **Fixtures (`fixtures/index.ts`):**
  - `devnet` (worker): the chain, plus `url(sub)`, `get(sub, path)`, and
    `psibase([...])` to run the CLI against it.
  - `supervisor`: boots the Supervisor in the page against this job's chain.
    `call({service, plugin, intf, method, params})` calls any plugin and
    `loadPlugins([...])` preloads plugins. `frame` is the Supervisor iframe.
  - `throwawayAccount`: a fresh P-256 keypair and an account on this chain
    secured by it, deleted after the test. No secrets are used anywhere.
  - `watchEventLoop(pageOrFrame)`: longest gap between timer ticks and
    animation frames in that context.
- **Layout:** shared config and fixtures at `e2e/` root; specs under
  `specs/<package>/**/*.spec.ts`.

### Chain binaries (fixture path)

`fixtures/devnet.ts` also looks for `psinode` / `psibase` via `$PSIDK_BIN`,
the repo `build/` tree, `e2e/.cache/psidk/bin` (from `scripts/fetch-psidk.sh`),
then `$PATH`. Prefer the standard `PSINODE_BIN` / `PSIBASE_BIN` /
`PSIBASE_PACKAGES` variables from the base (set automatically under CTest).

### Boot time

Measured on a dev box (8 vCPU, Debian 13, release v0.29.0-pre): starting
psinode, running `psibase boot` with the default package set, and waiting
until the Supervisor app is served takes about 7.6 to 8.9 s per chain
(median about 8.3 s). That cost is paid once per worker, not once per spec.

### Current specs (`specs/supervisor/`)

| Spec | Today | Purpose |
| --- | --- | --- |
| `smoke.spec.ts` | passes | Harness boots: chain up, throwaway account created, Supervisor loaded, a `host:http` plugin call succeeds. |
| `fetch-sync.spec.ts` | passes | Plugin fetch through `host:http` → bridge `send-request` returns the right body, once, and in sequence. Today this is the sync XHR path; later the no-JSPI fallback regression. |
| `fetch-async.spec.ts` | **expected to fail** (`test.fail()`) | UI stays responsive during a 2 s plugin fetch. Passes once JSPI-backed fetch lands. |

All three specs make plugin calls one at a time, so they behave the same with
the Supervisor's `serialize` queue (the plan for the current async round).

#### What the async test measures

While a 2 s `host:http` fetch is in flight, it measures longest timer and
animation-frame gaps in the app page and Supervisor iframe, plus click
round-trip from the test side. It asserts those stay under 500 ms.

Today sync XHR blocks the shared same-site renderer thread, so the app UI
freezes for ~2 s on both Chromium and WebKit. With JSPI the Wasm call
suspends and the thread stays free even though `serialize` still holds the
next `entry`.
