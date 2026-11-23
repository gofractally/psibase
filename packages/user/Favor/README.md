# Favor

A psibase application for private payments through bilateral lines of credit.
The UI, fonts, plugin and services are hosted on chain at `favor.<chain-domain>`.
There is no application API proxy or separate production web server.

The current local deployment is **http://favor.psibase.localhost:8089/**.
Connect a psibase account through the native account prompt to use it.

## App

- Overview with balances and direct payment capacity, separately for each symbol.
- People picker backed by the existing Profiles Contacts plugin. Reading Contacts
  requires its normal permission. Saving a nickname uses the same address book;
  adding a contact and extending credit are explicit, separate choices.
- Independent credit limits on both sides of a relationship, per-relationship
  forwarding fees and a forwarding switch.
- Payment review showing the exact recipient amount, fees and maximum total.
- Personal payment, forwarding-fee and repayment history with pagination.
- A creditor can acknowledge an external repayment without creating new debt.
- One-use payment requests, QR codes, optional exact amount and payer, expiry,
  revocation, and optional request-only receiving.
- Payment request secrets travel in URL fragments and are preserved in the tab's
  session storage through native login redirects. They are cleared on payment,
  cancellation or sign-out. Only their hashes are stored on chain.

`?demo=1` is an explicit, browser-local sample mode. It uses sample identities,
local storage, and Web Crypto AES-GCM; it never sends real transactions. The
normal chain-hosted app uses the Rust service and native signing plugins.

## Accounting

A positive stored pair balance means the higher-numbered account owes the lower.
Each account sets only its own willingness to hold the other account's debt.
Payments reduce existing debt before creating obligations in the opposite
direction. Lowering a limit never erases debt; it blocks additional exposure.

A forwarding fee belongs to the intermediary on its outgoing relationship. For
example, Alice paying Carol 20 USD through Bob at Bob's 1% fee means Alice owes
Bob 20.20 and Bob owes Carol 20. Bob retains a 0.20 receivable. Payers do not pay
an additional forwarding fee on their own first edge.

Amounts are exact integers with eight decimal places, represented as decimal
strings at the API boundary. Each amount/limit is at most 90,000,000 units.
Symbols are independent 2–12 letter uppercase denominations, not deposited
psibase tokens. No currency exchange or external settlement is implied.

## Routing and privacy

**Search runs only in authenticated queries.** A deterministic backwards
priority search finds the cheapest feasible simple path of up to seven edges,
including integer fee rounding and capacity. It does not split payments. Neighbors are loaded lazily from the private account-and-symbol indexes; unrelated
components are not scanned. Each search is bounded to 20,000 inspected directed edges and 50,000 queue/work labels; exhausting the
budget returns a generic unavailable result rather than an unproven optimum.

A successful query returns the complete route in a self-contained envelope:

- Public payer/payee, symbol, amount, total, expiry, reference and request hash.
- Seven fixed-size encrypted slots, including unused random padding.
- A fresh 192-bit nonce and an outer HMAC that authenticates all slots, including
  padding. Tampering with unused slots cannot provide a hop-count oracle.
- Each actual slot contains a private line ID, transfer amount, line revision
  and encrypted end marker. Its XChaCha20-Poly1305 key is derived with HMAC-SHA256
  from a service secret, payment context, resolved current account and position.

**The signed action contains the full envelope and the approved payment
summary.** Execution authenticates it, walks at most seven rows, checks current
capacity, fees, revisions, receiving policy and request status, then updates all
balances atomically. Execution and replay never call search or depend on a
query server's cached route. A used `(payer, reference)` cannot execute twice.
Changes to credit settings invalidate outstanding previews. Capacity changes
allow execution only if the quoted route still fits. Requests and previews are
checked again during execution.

The operator provisions a random 256-bit routing key in protected objective
service state. `favor::rotate_key` requires the service account's authorization;
rotation invalidates old previews. No key is in the WASM, UI, source, query
response or deployment log. Validators/node operators with access to objective
state are within the privacy trust boundary. This is not privacy from validators.

Queries derive identity solely from the native HTTP server. They expose only
the caller's direct relationships and personal receipts. Intermediaries see
only their adjacent accounts, transferred amounts and earned fee; they never
receive remote endpoint memos. No public graph or route-decoding API exists.

Successful open-receiving quotes necessarily reveal reachability and price to
the authenticated payer. Query work is bounded, but there is no network-wide
query-rate quota here. Request-only receiving requires a high-entropy bearer
secret before search; revoked, expired or consumed requests cannot be quoted or
paid. Generic routing failures do not identify a failing intermediary.

## Build and deployment

From `ui`, run `npm ci`, `npm test`, and `npm run build`. `node ui/build.mjs`
installs dependencies only when its lockfile changes, then builds. CMake also
builds the UI, packages Favor and includes it in the package index.

The checkout also needed one existing fracpack compatibility fix: replacing an
unstable `Option::map_or_default` call with the equivalent stable
`map_or_else(Default::default, …)` so the installed Rust toolchain can build it.

Build the service package with a cargo-psibase binary matching this checkout:

```sh
cargo psibase --manifest-path packages/user/Favor/Cargo.toml package
```

Install the resulting `Favor.psi` through the normal psibase package installer.
Its dependencies include Homepage, Profiles, Host, WebCrypto and native account,
permission, transaction and hosting services. The service account name `favor`
must be authorized under the network's short-name policy. A root-authorized
installation can preapprove the name; an application installer cannot bypass
that policy.

After installation, provision the random routing key once. The included
`deploy.py` can build and publish to already-created service accounts using
native `deploy`, `dyn-ld`, and Sites `upload` calls:

```sh
python3 packages/user/Favor/deploy.py \
  --api http://psibase.localhost:8089/ \
  --target-dir /absolute/path/to/favor-target \
  --cli /absolute/path/to/psibase \
  --tool /absolute/path/to/cargo-psibase \
  --psitest /absolute/path/to/psitest \
  --init-key
```

Omit `--init-key` when updating an existing deployment to preserve outstanding
previews. Add `--sign /path/to/key.pem` when the service owner requires signing.
Keys are generated in process memory and sent on stdin, never printed or saved
by the helper.

Some older 0.29 chains export transaction assembly as `transact:plugin/intf`
instead of `transact:plugin/api`. `plugin-legacy` compiles the same implementation
against that interface; use `--legacy` for those chains. The local deployment
uses this adapter. The UI detects the legacy Accounts query API and otherwise
uses `host/accounts`. It loads the chain's `/common/common-lib.js`, matching the
installed Supervisor rather than bundling a different protocol version.

The local chain's older installer could not preapprove the short service name
when installing as `accounts`. The service accounts were preapproved and created
with their normal delegated owner, then the services, dependency links, plugin
and Sites assets were deployed directly. The packaged artifact remains available
for a standard root-authorized installation.

## Verification

Verified locally: 50 WASM tests pass (20 deployed-contract scenarios and 30 unit
cases), together with five rejection-helper checks. The same 30 unit cases also
pass natively.

Run the isolated contract suite from the repository root:

```sh
PSIBASE_DATADIR=/absolute/path/to/sdk/share/psibase \
CARGO_PSIBASE=/absolute/path/to/cargo-psibase \
CARGO_PSIBASE_PSITEST=/absolute/path/to/psitest \
CARGO_TARGET_DIR=/absolute/path/to/favor-target \
bash packages/user/Favor/test/contract.sh
```

Use a matching SDK package registry in `PSIBASE_DATADIR/packages`. The script
runs the rejection-helper checks, builds both WASM services, embeds those exact
artifacts in the test binary, then runs `cargo-psibase psibase test -p favor`.
Append a test-name filter for a focused run. It boots an in-process `psitest`
chain and deploys the contract and query
service directly, without connecting to a node or running the UI. Every fixture
starts from a fresh chain clone; the persistent demo circle is untouched.

`service/src/contract_tests.rs` covers every Favor action, bilateral limits and
zero-crossing payments, multiple symbols, fees and rounding, forwarding controls,
capacity/settings/key changes, expiry, request ownership and lifecycle,
repayment authority, signed authentication, replay, private queries and pagination,
seven/eight-hop boundaries, and full transactions replayed on an independent
chain that has never queried the route. The replay fixture forks committed state
before quoting, so both chains share row IDs, key epochs and TAPOS history; both
execute the same packed transaction bytes. It also executes a BTC payment and
checks that the USD relationship is unchanged. The state-machine case executes 160
deterministic transitions and compares quotes against an independent exhaustive
path oracle and every balance against a separate ledger model.

Each contract rejection requires the expected message at the specified action
and byte-for-byte equality of all seven Favor tables: lines, receipts, counters,
payment markers, keys, preferences and requests. Valid payments, repayments,
request creation/revocation, policy changes and key rotation followed by a
deliberately failing action exercise whole-transaction rollback and retry.
The signed cases use test-only P-256 keys and reject missing/wrong claims,
forged senders and invalid signatures before checking successful signed actions.

- `cargo test --manifest-path packages/user/Cargo.toml -p favor --lib`: native
  tests, including exhaustive reference comparisons on 500 generated graphs,
  envelope tampering, context binding, capacity, rounding, cycle/depth limits,
  stale revisions, forwarding, query-budget failures and route-only database reads.
- `python3 -m unittest discover -s packages/user/Favor/test -p test_rejections.py`:
  verifies that CLI/transport failures, missing traces, successful target actions
  and failures in unrelated actions cannot pass the rejection helper.
- `npm test` in `ui`: 17 exact-amount, request-link, demo-state and native API
  adapter tests. The adapter tests run the production TypeScript with a mocked
  Common API transport, including current/legacy account routing, private-page
  cursors, exact payment parameters and query failures. They do not execute
  installed WASM plugins or drive a browser.
- `test/live.py --cli /path/to/psibase`: 28 checks on the actual local WASM
  services, including native transactions, multihop fees, privacy,
  tampering, rollback, replay, requests, revocation and external repayments.
  Creates only dedicated test identities and a fresh `TST…` symbol.
  Negative transactions require a structured trace with the expected Favor
  action error and unchanged participant state; rejected queries require the
  specific expected error. This optional smoke script is separate from the
  isolated contract suite above.
- Production UI build and native WASM service/plugin packaging completed.
- Browser checks covered the sample payment/repayment/request flows and native
  chain-hosted startup and account prompt. Importing a user's account remains
  the native wallet's task; the app never collects private keys.

A seven-hop cryptography microbenchmark is included in the native tests. Native
measurements are not WASM latency claims. Live transaction wall time also includes
CLI work and block confirmation, not just cryptographic execution.

## Persistent USD demo circle

`test/seed_demo.py` provisions five dedicated AuthSig identities and ten directed
USD credit limits on a loopback chain. It stores private signing keys outside
the repository, with private directory/file permissions. Its journal skips
completed setup steps, preserving subsequent demo payments.

```sh
python3 packages/user/Favor/test/seed_demo.py \
  --cli /absolute/path/to/psibase \
  --state-dir /absolute/path/to/private-demo-state
```

Import each identity through Favor's native account prompt using its generated
`keys/<account>.pem` file. These are demo identities with test IOUs; no USD tokens
are issued or deposited. Native Profiles display names are also configured.

| Person | Account | Role |
| --- | --- | --- |
| Dan | `favordan` | Payer; credit from Mike and Leah |
| Mike | `favormik` | 1% forwarding fee toward Carol |
| Leah | `favorlea` | Alternative route, 2% toward Carol |
| Carol | `favorcar` | Recipient; 0.5% toward Nora |
| Nora | `favornor` | Recipient after a three-edge route |

Dan and each of Mike/Leah extend one another 100 USD. Carol extends Mike and Leah
200 USD each; they each extend Carol 100 USD. Nora extends Carol 200 USD, and
Carol extends Nora 100 USD. All these relationships allow forwarding.

Setup executes a 20 USD payment from Dan to Carol (20.20 total), a 10 USD payment
from Dan to Nora (10.1505 total), and Carol's acknowledgment of a 5 USD external
repayment from Mike. After setup, Dan owes Mike 30.3505 USD, Mike owes Carol
25.05 USD, and Carol owes Nora 10 USD.

Fresh quotes verified immediately after setup:

| Payment from Dan | Recipient receives | Fee | Total |
| --- | ---: | ---: | ---: |
| To Carol | 10 USD | 0.10 USD | 10.10 USD |
| To Nora | 10 USD | 0.1505 USD | 10.1505 USD |
| To Carol, using the alternative route | 80 USD | 1.60 USD | 81.60 USD |

The final case uses Leah because Mike's remaining capacity is 69.6495 USD.
For another repayment test, sign in as Carol, open Mike's USD relationship,
and record 5 USD received. This reduces only Mike's debt to Carol. Subsequent
payments naturally change these balances and available routes.
