# Native Psibase exchange demonstration

## Current head-based demo

The validated current-source demo is **http://exchange.psibase.localhost:8096/**.
It runs the locally built Wasmtime/psitri node, current native service packages,
and Exchange on `codex/app-regression`, based on `bytemaster/head` commit
`054a0c386`. Its BTC/USD relay was funded at the observed live BTC price; the
background Coinbase follower submits funded native transactions independently
of the browser. Its normal target is one submission per second, with bounded
pauses when feed data or confirmations are unavailable.

From this checkout, after the SDK and fresh chain have been prepared:

```sh
source build-app-regression/head-demo/env.sh
python3 demo/run.py start
python3 demo/market_activity.py start --interval 1
python3 demo/run.py status
```

`python3 demo/run.py stop` drains the bot and stops this node. The environment
selects the CLI, node, API and state directory through `EXCHANGE_CLI`,
`EXCHANGE_NODE`, `EXCHANGE_CHAIN`, and `EXCHANGE_DEMO_STATE_DIR`. Each demo keeps
its own database, seed marker, bot configuration, PIDs and logs. PID checks
verify the process before signaling it, and startup checks the listen port.

The current SDK is under `build-app-regression/head-sdk`; its registry contains
65 packages built from this source. `provenance.json` records binary hashes and
pinned dependencies. Native Exchange tests passed with this matching tester:
76 passed, zero failed, six WASI panic tests ignored; all 42 host tests passed.
The exact live zero-output maker-boundary regression is included. The Exchange
README documents the remaining zero-output loan/stop boundary limitation.

The dedicated taker was given 100 BTC and 10 million USD of local demo working
capital from the liquidity fixture's existing primary balances. It can refill
in bounded chunks of 5 BTC or 500,000 USD when its available funds fall below
1 BTC or 100,000 USD. Pending trade inputs and unconfirmed refills are reserved.
The additional lifetime allowance per persisted chain is 1,000 BTC and
100 million USD. It never mints tokens or draws from human wallets or committed
relay/lending reserves. Each refill joins the ordinary trade transaction.
Allowance is durably charged before publication and is not restored after a
rejected or unknown outcome. Exhausting the allowance or source funds pauses
trading. The native refill-plus-trade path was verified against actual token
balances; this fixture uses AuthAny rather than cryptographic signatures.

Fresh seeding supports `python3 demo/seed.py --price-usd PRICE`; it refuses a
second issuance when its state directory already has a seed marker. This is a
local development network using demonstration tokens.

See [query performance](QUERY_PERFORMANCE.md) for measured throughput, CPU
attribution, workload sizes and profiler overhead. CPU profiling is optional;
the normal demo runs without it.

## Earlier persistent demo on 8089

The running application is **http://exchange.psibase.localhost:8089/**, served
by the native Sites service under the exchange account's subdomain. The native
Psibase node listens on **127.0.0.1:8089**. Signing, account connections and
cross-app transfer consent use the native Supervisor, Host and Tokens plugins.
The retired development wallet HTTP server on 8090 is stopped and is not started
by `demo/run.py`. The bot uses the native CLI independently of the browser.
All orders, fills, market makers, lending positions, collateral and repayments
execute in native Psibase services and persist in its database.

## Source and running state

The implementation is in `/Users/dlarimer/psibase-exchange`, branch
`codex/exchange`, based on GitHub main `db601e572`. The original
`/Users/dlarimer/psibase` contains pre-existing work on its `psitri` branch and
was preserved. GitHub updates were fetched there; the clean current-source
checkout avoids overwriting its custom database and uncommitted Rust work.

The contract is `packages/user/Exchange/service`; native tables are in
`tables.rs`, checked arithmetic in `math.rs`, and the HTTP read service in
`query-service`. See [the design and proof](../../packages/user/Exchange/README.md)
and [the security review](SECURITY.md).

```
cd /Users/dlarimer/psibase-exchange
python3 demo/run.py start
python3 demo/run.py status
python3 demo/run.py stop
```

To publish a changed UI through the same native account:

```sh
python3 demo/publish_ui.py
```

The Exchange package also contains its UI files under the native Sites data
layout and declares Sites and Events dependencies. Its post-install actions
configure market indexes for trade, liquidation and stop execution history. The query service
returns `None` for static asset paths so HttpServer can apply its standard
Sites fallback; it retains the native action-schema developer endpoints.
The demo publishing script grants the native Supervisor frame access; it grants
no development-wallet endpoint. Rebuilding the native client stack uses
`demo/build_native_wallet.py` and `demo/publish_native_wallet.py`; component
files, dependency links and native prompt routes must match, rather than mixing
client protocols from different SDK revisions.

`start` retains existing chain state and starts the native node independently
of a terminal. It does not reset balances or issue more tokens. PIDs and logs
are under `demo/`; the database is `demo/chain/`. PID checks refuse to stop a
reused PID belonging to another program. Do not run two nodes against the same
database directory.

## Demo wallets and assets

The account menu connects accounts through native Host. For the local fixture,
import `alice`, `bob`, `carol` or `liquidity` in the native account prompt. These
accounts use AuthAny and therefore have no private-key field. They remain
insecure development identities: a native wallet UI does not make AuthAny
secure. The demo also has an unsigned single-producer administrative root; see
[NATIVE_WALLET_REVIEW.md](NATIVE_WALLET_REVIEW.md). Public deployment requires
secured users, producer claims and independent upgrade authorities.

The ticket has **Spot | Margin | Deposit | Withdraw**. A deposit opens the
Tokens-owned exact-transfer confirmation. Its initially unchecked **Trust
exchange** option remembers a client-side wallet↔Exchange permission for later
transfers on this browser. The account menu exposes Assets, native per-token
exchange transfer history and permission revocation. This transfer history is
not a complete order/fill audit. Available proceeds are implicitly prepared
when spending or withdrawing; unknown transaction outcomes are never retried.
The financial service always derives the actor from `get_sender()`.

BTC and USD are **local demonstration assets**, not externally redeemable
bitcoin or dollars. BTC has eight decimals; USD has four. The legitimate
native `symbol` service reserves and maps `btc` and `usd` to their actual
token IDs. Display names come from those mappings, not caller-provided labels.
After issuance and mapping, the tokens are made unrecallable and their
administration NFTs are burned. Their transferability can no longer be
changed by an issuer.

The initial market has 100 BTC and 10,000,000 USD in its relay, giving an
initial price of 100,000 USD/BTC. Its base lot is 0.0001 BTC and tick is 1 USD.
Real limit orders are seeded around that price, with two wallets
placing bids at the same price. The liquidity wallet supplies both lending currencies.
Alice starts with a small active long loan at an 80,000 USD trigger. Subsequent
demo interactions change those balances normally; they are not reset on reload.

### Dense book and background trading

```sh
python3 demo/market_activity.py seed
python3 demo/market_activity.py start
python3 demo/market_activity.py status
python3 demo/market_activity.py stop
```

The additional fixture funds three dedicated maker accounts and one taker from
the existing liquidity wallet, using existing native tokens. It initially adds
96 funded limit orders across 24 bid and 24 ask prices; most prices contain
orders from two wallets. Re-running it tops up missing maker inventory instead
of resetting other users' orders or balances. Maker and taker setup is recorded
in `demo/market-activity.json`.

The current fixture sizes each maker contribution at 0.0480–0.2596 BTC and
rotates bounded replenishment through the three dedicated makers every four
seconds. It raises no new tokens. Both maintenance and that second's taker
trade share one native transaction. Initial fixture setup may skip prices too
close to the current relay to preserve its planning-time passivity guard;
subsequent real fills and quoting change the displayed level count normally.

The trader runs independently of the browser. A Node 22+ worker receives the
public Coinbase Exchange BTC-USD WebSocket ticker and heartbeat channels.
The Python trader targets **one native transaction per second**, overlapping a
bounded number of confirmation waiters. Actual execution remains serialized
by the chain. Replenishment actions occasionally join the same transaction.
Source protocol: [Coinbase Exchange channels](https://docs.cdp.coinbase.com/exchange/websocket-feed/channels).

The bot targets the **absolute live BTC/USD price**, buying below the feed and
selling above it. The demo does not become an externally redeemable BTC/USD
market. Trade sizes are bounded and the bot pauses if the feed is stale, a live
move exceeds its 5% operating band, or confirmations fall behind; rejected
transactions or exhausted dedicated funding stop it. It never obtains outside
funds or cancels other wallets' orders. Between unchanged feed ticks it submits
a small two-sided trade around the target, so all displayed volume is actual
native execution. This is a development liquidity fixture, not a profit strategy.

The original $100,000 fixture was aligned with the live ~$57,000 price using a
funded marketable limit order, with its remainder canceled in the same atomic
transaction. Resting user orders and the $80,000 margin trigger execute normally
along that path; balances are not rewritten. The dedicated makers' former
quotes are canceled and replaced around the live price.

Only native exchange data reaches the browser. Feed source, timestamps and bot
status stay in `demo/market-activity.log` and `demo/market-activity-status.json`.
Stopping the bot retains funded orders. `demo/run.py stop` also stops the
background trader before the native node; `start` starts the native node,
and the trader can be started explicitly using the command above.

### Charts and order-book display

Candlesticks use confirmed native execution events and native block times,
with 5-second, 15-second and 1-minute intervals. Each execution is an aggregate
taker fill, liquidation or same-direction stop batch, so its displayed price
is its actual quote/base VWAP. Event commit order does not reproduce every
intermediate marginal price in an auction. Empty time
buckets are not filled with invented trades. The paginated history endpoint
uses the native market event index to select a bounded number of event IDs
before fetching exact history rows; it does not sort the entire chain history.

Depth shows the relay and resting orders in a symmetric, configurable
percentage window around the **current** price. Zoom changes only that display
window. Old distant orders remain on chain and do not stretch the viewport.
At the relay's own marginal price, the BTC and USD reserves have equal value:
`P = USD_reserve / BTC_reserve`, hence `BTC_reserve * P = USD_reserve`.
Their raw quantities change after trading without implying a value imbalance.

Try the following flows:

* Deposit from the selected wallet into native shared token funding, then
  withdraw some free funding back into its native primary balance.
* Buy or sell through relay liquidity, place a passive limit order, cancel
  it, or submit a marketable limit with a hard execution price boundary.
* Borrow against pledged BTC or USD, repay units, supply lending cash, or
  redeem lending shares subject to available cash.
* Add relay liquidity, attempt a withdrawal, and observe that a withdrawal
  which would invalidate loan recovery is rejected atomically.
* Create another independently funded order book for any native token pair.
  Books may share a pair but have separate IDs, native escrow subaccounts,
  liquidity and debt. The first creator cannot monopolize a pair's lot grid.

Accrued maker proceeds and funded liquidation surplus are included in usable
funds. The wallet folds the user's own settlements into the same transaction
as spending or withdrawal; no separate claim step is required. Both native
auto-debit settings are handled without counting delivered tokens twice.

## The margin guarantee and its bounds

Margin is enabled only for books created with immutable transferable,
unrecallable assets. This eligibility is fixed at creation. An older spot
book cannot become a guaranteed credit book merely because its issuer later
burns administration powers after recalling its backing.

Every market holds committed funds in native token subaccount `market-ID`.
Free user funds remain separate native shared balances. Expected committed
cash is checked against the actual subaccount before transfers. A recalled
spot book is quarantined and cannot consume another book's funds. The wallet
also avoids automatically settling claims from a damaged book, so it cannot
block unrelated withdrawals.

Loan debt has a fixed face amount including its financing charge. Credit has
a 30-day term, renewable only after active debts are extinguished. The
ordered liquidation certificate reserves for earlier price cohorts' price
impact. Liquidation closes a complete price cohort without visiting its
borrowers. Lending redemptions require cash, and relay liquidity cannot be
withdrawn if the remaining liquidation schedule would be undercovered.

Amounts used by the matching/credit arithmetic are bounded to `2^40-1` atoms,
prices to positive 32-bit ticks, and active loan prices to 64 per market.
Wide persisted values use two native `u64` limbs. The prototype deliberately
rechecks the bounded price schedule; it does not claim a logarithmic risk
tree implementation. Uncommitted native wallet balances retain their full
`u64` range, and the UI uses exact integer conversion.

This is repayment-token solvency under the specified token, service and
consensus rules. It does not promise an external currency peg or immunity
from an authorized replacement of the blockchain's contracts. The repository
includes an algebraic proof and executable checks; it is not a third-party
production audit.

## Build and verification

The current-source node, tester and Rust CLI were built locally. The macOS
changes include Darwin environment access, explicit integer configuration
serialization, `O_PATH` portability, ICU linking, and correct WASI symlink
following and read-error handling. A stable-Rust equivalent replaces an
unstable `Option::map_or_default` call. Fresh bootstrap now creates its
producer account before setting that account's authentication.

The platform-independent WASM libraries and baseline packages come from the
official `v0.29.0-pre` SDK. Relevant services with newer interfaces are built
from current source and overlaid before the first chain boot. This includes
Accounts, Invite/RInvite, Tokens, NFT, Symbol, DiffAdjust, NameMarket,
VirtualServer and Credentials. The overlay also translates old package
initialization arguments from `requireMatch` to the current account `mode`.
The exchange package is copied into the overlay, freezing its chosen build.
Hashes are recorded in `demo/artifacts/source-artifacts.json` and its package
`index.json`.

The token tuple-index change must exist from the first shared-balance write.
**The overlay is for a fresh chain, not an index migration for an existing
network.** Never replace an existing network's Tokens service with it without
an independently validated migration.

Rebuild the application and tests using the locally built tools:

```sh
cd /Users/dlarimer/psibase-exchange
npm --prefix packages/user/Exchange/ui run build
npm --prefix packages/user/Exchange/ui test
python3 -m unittest discover -s demo -p 'test_*.py' -v
python3 packages/user/Exchange/test_stops.py
python3 experiments/stop-cascade/test_reference_model.py
python3 demo/verify_exchange.py test
python3 demo/verify_exchange.py package
python3 demo/check_live.py
```

`verify_exchange.py` builds an isolated snapshot of the committed workspace
manifests plus current Exchange sources and the native fixture-fork helper.
This prevents another task's unfinished workspace packages from affecting
verification. It records source hashes under `build-exchange-verification/`.
It does not alter those concurrent sources or manifests. The host stop harness
extracts the production Rust planner and claim arithmetic; it complements the
native suite and does not exercise native token custody or authorization.

Native benchmark repeats fork identical funded chain state and fixed block
time. Only the individual transaction is timed; boot, fixture construction,
forking and full post-action audits are excluded. See
[the validation report](VERIFICATION.md) for distributions and confidence
boundaries. Measured durations are variable; exact outputs, work counts and
accounting assertions are deterministic.

Native test cases perform independent cash, ownership, share,
unit and complete liquidation-schedule audits, including rejected-transaction
rollback and the historical-recall isolation attack. The live checker is
read-only and checks the deployed snapshots; it does not replace the tests'
complete escrow audit. `demo/persistence-verification.json` records a successful
controlled restart: all four complete financial snapshots were identical
before and after stopping and restarting both the native node and wallet.

`demo/accounts-build/build.py` and `demo/invite-build/build.py` reproduce the
C++ service builds using the installed macOS WASI compiler and current headers.
`demo/prepare_packages.py` builds the fresh-boot overlay. `demo/seed.py` issues
and funds the demo only on a fresh initialized chain and refuses to run once
`demo/seed.json` exists. It is not a balance-reset endpoint.

Native private snapshots require the HTTP server's authenticated user. The
wallet obtains a native login bearer token and keeps it only in memory.
Repeated reads use read-only RPC rather than broadcasting balance queries.
Only the query service has the explicitly reviewed privilege needed for
static foreign-table read handles; the financial exchange service has none.
The bridge also enforces a bounded action allowlist, Host and Origin checks,
request size limits, and native authorization failures. Its development
account selector is never a substitute for production wallet authorization.
