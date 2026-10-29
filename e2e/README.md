# psibase browser e2e harness (Playwright)

**Local development only.** This suite is a facility for developers to run on
their own machines. It is deliberately **not** wired into CI; whether and how
to run it in CI is a future decision (see `wasm-async-fetches.md`,
"Playwright e2e harness plan").

## Quick start

```sh
cd e2e
yarn install       # yarn 4.18.0 via corepack (`corepack enable`), same as packages/
yarn setup         # browsers (+ OS deps, needs sudo) and the pinned psibase SDK
yarn e2e           # the one run command: both browsers, in parallel
```

Useful variants: `yarn e2e --project=chromium`,
`yarn e2e specs/supervisor/fetch-sync.spec.ts`,
`yarn playwright show-report` (HTML report of the last run).

`e2e/` is its own yarn project (own `yarn.lock`, `.yarnrc.yml`), not a member
of the `packages/` workspace, which holds the app and plugin UIs. It uses the same
yarn version and the shared `../.caches/yarn` cache, but the `node-modules`
linker instead of PnP, because Playwright's runner and browser installer
expect a real `node_modules`.

## What it does

- **Two projects, run in parallel:** `chromium` and `webkit` (WebKit stands in
  for Safari). Versions are pinned by the exact `@playwright/test` version in
  `package.json` (1.64.1 → Chromium 156.0.8078.4, WebKit 27.2). Bump that one
  version to move browsers.
- **One isolated chain per browser job.** Each project has one worker
  (`workers: 1` per project). Each worker boots its own devnet in a temp data
  dir: `psinode` on port `E2E_PORT_BASE + 10*parallelIndex` (default 28080 /
  28090) and a proxy on the next port. No ports, data dirs or endpoints are
  shared between jobs. Chains are torn down when the worker exits.
- **Proxy (fixtures/proxy.ts)** sits in front of each psinode. The browser only
  talks to the proxy. It forwards everything to psinode and adds test-only
  routes on every subdomain:
  - `/__e2e/harness.html`: a minimal app page that embeds the Supervisor
    iframe and speaks its postMessage protocol (`window.e2e.call`, `preload`).
  - `/__e2e/sleep?ms=N&tag=T`: waits N ms, then returns
    `{tag, ms, start, end}`. This is the sleep-and-timestamp fixture. It lets
    specs prove whether fetches overlap or block, with no real network.
    Every hit is recorded in `devnet.proxy.sleeps`.
- **Fixtures (fixtures/index.ts):**
  - `devnet` (worker): the chain, plus `url(sub)`, `get(sub, path)`, and
    `psibase([...])` to run the CLI against it.
  - `supervisor`: boots the Supervisor in the page against this job's chain.
    `call({service, plugin, intf, method, params})` calls any plugin and
    `loadPlugins([...])` preloads plugins. `frame` is the Supervisor iframe,
    for driving or observing it from the test side.
  - `throwawayAccount`: a fresh P-256 keypair and an account on this chain
    secured by it, deleted after the test. No secrets are used anywhere.
    It doesn't fund the account yet because no spec needs tokens. Add a
    transfer in the fixture when one does.
  - `watchEventLoop(pageOrFrame)`: measures the longest gap between timer
    ticks and between animation frames in that context.
- **Layout:** the shared config and fixtures live at the root. Specs live per
  package under `specs/<package>/**/*.spec.ts`, and all of them are picked up
  automatically.

## Chain binaries

`fixtures/devnet.ts` looks for `psinode` / `psibase` in this order:
`$PSIDK_BIN`, the repo's `build/` dir (a local CMake build), `e2e/.cache/psidk/bin`
(from `scripts/fetch-psidk.sh`, pinned to release `v0.29.0-pre`), then `$PATH`.
Boot packages come from `$PSIBASE_PACKAGES`, or `share/psibase/packages` next
to the binaries. To test against packages you built yourself, point
`PSIBASE_PACKAGES` at your build's package dir. Set `E2E_PSINODE_LOG=1` to see
psinode's log.

## Boot time (open item 1 in the plan)

Measured on the dev box (8 vCPU, Debian 13, release v0.29.0-pre): starting
psinode, running `psibase boot` with the default package set, and waiting
until the Supervisor app is served takes **about 7.6 to 8.9 s per chain**
(median about 8.3 s over 16 boots). Both chains boot at the same time. A
full run of both browsers takes about 17 s wall time.

That cost is paid once per worker, not once per spec. So there's no
pre-warmed pool for now: it would add complexity to save about 8 s. Revisit
if there are many spec files that each need a fresh chain, or if boots get
slower. A failing test restarts its worker, and that boots a new chain.

## Current specs (`specs/supervisor/`)

| Spec | Today | Purpose |
| --- | --- | --- |
| `smoke.spec.ts` | passes | Harness boots: chain up, throwaway account created, Supervisor loaded, a `host:http` plugin call succeeds. |
| `fetch-sync.spec.ts` | passes | A plugin fetch through `host:http` → bridge `send-request` returns the right body, reaches the server exactly once, and works in sequence. Today this is the sync XHR path. After JSPI lands, it's the regression test for the sync XHR fallback (browsers without JSPI). |
| `fetch-async.spec.ts` | **expected to fail** (`test.fail()`) | The UI stays responsive during a 2 s plugin fetch. Fails today, passes once JSPI-backed fetch lands. Details below. |

All three specs make their plugin calls one at a time, so they behave the same
with the Supervisor's `serialize` queue in place, which is the plan for this
round. Nothing depends on two calls overlapping.

### What the async test measures

While a 2 s `host:http` fetch is in flight, it measures:
- the longest timer gap and the longest animation-frame gap in the top-level
  app page,
- the longest timer gap in the Supervisor iframe,
- how long a real mouse click on a button in the app page takes to be
  handled (timed from the test side).

The test asserts all four are under 500 ms. Measured on this box (4 runs):

| | app timer gap | app frame gap | Supervisor timer gap | click round trip |
| --- | --- | --- | --- | --- |
| Chromium | about 2040 ms | about 2017 ms | about 2037 ms | 1.70 to 1.85 s |
| WebKit | about 2020 ms | about 2020 ms | about 2020 ms | 1.64 to 1.95 s |

**Which thread does sync XHR block?** The thread of the frame that issued it,
which is the Supervisor iframe. That iframe is cross-origin to the app but
same-site, since both are under `psibase.localhost`. Chromium's site isolation
works per site, so the two share one renderer process and main thread. WebKit
runs the whole page in one web process. So today the fetch freezes the app's
own UI, not just the Supervisor, in both browsers, and the numbers above
confirm it. In production, where apps and the Supervisor are subdomains of
one root domain, it's the same situation. With JSPI the Wasm call suspends
and the thread is free, even though `serialize` still holds the next call
back.

The click's own `event.timeStamp` latency is recorded but not asserted.
Browsers stamp the event when the renderer reaches it, which hides the
wait. For example, it reads 1 to 8 ms today.

Note: Playwright's WebKit 27.2 already has `WebAssembly.Suspending` (JSPI).
To exercise the no-JSPI fallback after the async work, you'll need an older
WebKit or a way to turn JSPI off. That's a follow-up.
