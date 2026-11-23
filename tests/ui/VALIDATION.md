# Application regression validation

Validated on 2026-11-23 from `bytemaster/head` commit
`054a0c38665f5e378be2089dc7eabe005c95fc0d`, with the fixes and automation on
`codex/app-regression`. The target branch itself has not been changed.

## Results

The complete locked-install runner, `node tests/ui/run.mjs --install`, passed:

- All 19 bundled app UIs plus common-lib built. Static ETH Bridge JavaScript
  passed its syntax check. This includes Supervisor as an internal UI target.
- All 78 UI logic tests passed: Exchange 40, Tokens 11, Favor 17,
  Supervisor 8, XAdmin 2.
- All 40 Chromium browser scenarios passed together (6.9 seconds on the local
  run), covering the 19 user-facing UIs below.

| App | Browser checks |
| --- | --- |
| Exchange | Book, candles, volume, depth range, exact order amounts, cancellation, margin, lending, relay liquidity, funding, account privacy, market creation, mobile layout, logout, late candle response |
| Tokens | Actual transfer prompt, amount display, escaping, one-time approval, explicit trust, cancellation, rejection, invalid review |
| Favor | Payment review and local persistence, amount rejection, request links/QR/revocation, repayment, separate currencies, production API connection/payment |
| Homepage | Public landing, Wallet/marketplace access gates, signed-in Wallet/Pending, cancel Auto Debit consent |
| Host LoginPrompt | Import/create navigation, save-key acknowledgement, account autofill, key confirmation and credential import/connect requests |
| Config, Workshop, Permissions | Landing and access screens |
| Explorer | Block data and public block-list navigation |
| Fractals, FractalCore | Connection gate, configured fractal and mission |
| Identity, Evaluations, TokenStream | Graph control, evaluation form, stream list and creation gate |
| Plugin tester | Service schema and exposed API methods |
| BTC Bridge | Current Host account interface, guest spending gate, public reserve browsing |
| ETH Bridge | Static UI, history navigation, Host connection/login, exact withdrawal and precision rejection |
| XAdmin, XProxy | Read-only node dashboard, proxy origin editing without saving |

Supervisor has eight happy-dom logic tests and a successful production build.
Its actual production iframe/WASM startup is not exercised by the browser
fixtures. The real Common API browser message client is exercised against a
fixture Supervisor iframe in the shared-app tests.

Additional checks passed separately: Exchange service 39 host tests, Exchange
plugin planner/publication 26 host tests, Favor service 30 host tests, Tokens
transfer policy 12 Rust tests, Exchange service/query WASI compilation, and
Exchange's math, stop-reference and demo helper suites. These are separate
from the 78 UI tests and do not imply execution on a native chain.

All six actual WASM components also built successfully: Exchange, Tokens,
Favor, BTC Bridge, BTC Relay and ETH Bridge. The command used
`cargo component build --manifest-path packages/user/Cargo.toml --release`
with the six `-p` plugin selections listed in the CI workflow, WASI SDK 24
compiler/sysroot settings, and a separate QA target directory.

## Fixes found during validation

1. Exchange could crash when public candles arrived after account switching
   had cleared the market snapshot. Drawing now waits for market metadata;
   a deterministic browser case recreates that timing.
2. Shared key confirmation left the known account name blank. It now prefills
   that account while still requiring the private key. The new assertion
   failed against the old bundle and passed after rebuilding.
3. BTC Bridge called removed Accounts login methods, and its native plugin
   and BTC Relay used outdated local WIT interfaces. The UI now uses Host;
   both plugins use the canonical current interfaces, including Transact API.

The base branch had UI logic tests, but no committed Playwright/Cypress browser
suite or CI gate running the UI tests. XAdmin's existing tests also lacked a
package test command. This branch adds both, including standalone apps omitted
by `yarn build:all`.

## Remaining validation boundary

The browser tests use controlled native/service responses. They prove UI and
request contracts, not actual signing, WASM execution, persistent cross-origin
cookies/trust, chain privacy enforcement, or movement of funds. Those need a
disposable chain built from the same revision and genuine Host/Transact/Tokens
flows. That full-chain browser run was not completed here; existing funded
developer nodes were left untouched.

The new CI configuration compiles six financial app WASM plugins as an
additional interface compatibility gate. Compilation and browser fixtures
still do not substitute for real signed chain integration tests. The workflow
must land before these gates protect `bytemaster/head` automatically.

Run instructions and artifact locations are in [README.md](README.md).
