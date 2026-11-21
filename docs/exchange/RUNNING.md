# Native Psibase exchange demonstration

The running application is **http://127.0.0.1:8090**. The native Psibase node
listens on **127.0.0.1:8089**. Both listeners are restricted to this computer.
All orders, fills, market makers, lending positions, collateral and repayments
execute in native Psibase services and persist in its database. The Python
adapter is a development wallet and static file server; it contains no matcher
or independent account ledger.

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

`start` retains existing chain state and leaves the node and wallet running
independently of a terminal. It does not reset balances or issue more tokens.
PIDs and logs are under `demo/`; the database is `demo/chain/`. PID checks
refuse to stop a reused PID belonging to another program. Do not run two
nodes against the same database directory.

## Demo wallets and assets

The wallet selector exposes `alice`, `bob`, `carol`, and `liquidity`. These
are deliberately insecure local development identities using native AuthAny.
They are not accounts to use on a public network. An actual deployment must
use its native wallet/plugin and account authentication in place of this
loopback development adapter. The native financial service always derives
the actor from `get_sender()`; the browser cannot supply another position's
owner as an action argument.

BTC and USD are **local demonstration assets**, not externally redeemable
bitcoin or dollars. BTC has eight decimals; USD has four. The legitimate
native `symbol` service reserves and maps `btc` and `usd` to their actual
token IDs. Display names come from those mappings, not caller-provided labels.
After issuance and mapping, the tokens are made unrecallable and their
administration NFTs are burned. Their transferability can no longer be
changed by an issuer.

The initial market has 100 BTC and 10,000,000 USD in its relay, giving an
initial price of 100,000 USD/BTC. Its base lot is 0.0001 BTC and tick is 1 USD.
Several real limit pools are seeded around that price, with two wallets
sharing one bid price. The liquidity wallet supplies both lending currencies.
Alice starts with a small active long loan at an 80,000 USD trigger. Subsequent
demo interactions change those balances normally; they are not reset on reload.

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
python3 -m unittest discover -s demo -p 'test_bridge.py' -v
rust/target/release/cargo-psibase psibase \
  --psitest="$PWD/build/psitest" -p exchange-pkg package \
  --manifest-path packages/user/Cargo.toml
rust/target/release/cargo-psibase psibase \
  --psitest="$PWD/build/psitest" -p exchange test \
  --manifest-path packages/user/Cargo.toml
python3 demo/check_live.py
```

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
