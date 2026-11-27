# Bitcoin bridge on Psibase

Rust objective services validate Bitcoin headers and transaction inclusion,
issue a native eight-decimal token, construct deterministic withdrawal batches,
and gather generic signatures to spend a native SegWit 2-of-3 wallet. Browser
code is TypeScript. The generic signing system lives separately in
[`../Signing`](../Signing/README.md).

## Components

- `../BtcRelay/service`: `btcrelay`, the checkpoint-anchored header relay.
- `service`: `btcbridge`, token issuance, custody outputs and withdrawals.
- `query-service`: public, read-only native HTTP snapshots and proof lookups.
- `core`: deterministic Bitcoin serialization, derivation, proof and signature rules.
- `ui`: a native Sites application with independently derived addresses,
  browser header/proof relay and transaction broadcast.
- `../../../demo/btcbridge`: isolated Bitcoin Core/Psibase development harness.

## Custody and signing

The BTC contract calls the generic signing service to request three independent
application-owned keys. Each provider publishes its extended public root. The
BTC contract verifies these roots when initialized and encodes them for the
selected Bitcoin network. Deposit index `i` uses
`wsh(sortedmulti(2,A/0/i,B/0/i,C/0/i))`; change uses branch 1 and the batch ID.
Recipient bindings are immutable. A proof submitter never chooses the credited
recipient. Registration occurs before an address is displayed for payment.

The BTC contract determines the entire unsigned transaction. Inputs are selected
by `(confirmation height, txid, vout)`; requests and outputs are ordered by
request ID. Version, locktime, sequences, fee rate and change derivation are fixed
by the authorized plan. Native SegWit keeps the transaction ID stable while
signatures are collected. Fee estimation conservatively budgets maximum witness
sizes. Fees are integer satoshis; no floating-point arithmetic is used by the
contracts. Batch network fees are divided equally among requests, with remainder
satoshis assigned in request order, and every request enforces its fee cap.

`requestSigs` computes the BIP143 SIGHASH_ALL digest for each selected input and
requests it under each owner-bound generic key. This is bounded and resumable.
The generic daemons only sign finalized hashes. `gather` obtains their on-chain
responses, verifies them against the Bitcoin transaction and assembles the
multisig witnesses. Anyone can broadcast the resulting public bytes. No custody
daemon needs Bitcoin connectivity or knowledge of Bitcoin spending policy.

## Relay and confirmation policy

Initialization commits a trusted block, its height, Bitcoin network, timestamp
context and difficulty-epoch context. Only the initializer's service authority
can initialize, once. Subsequent headers are permissionless. The relay checks
proof of work, target sign/overflow/limits, parent linkage, median time, future
time, buried block-version rules and exact mainnet difficulty transitions.
Timestamp and epoch metadata are cached per parent. Fork choice uses accumulated
work, not height. Regtest has its own easier target and no-retarget rules;
mainnet cannot accept those headers. Signet (`network = "signet"`) uses
Bitcoin's retarget arithmetic with signet's proof-of-work limit and no
minimum-difficulty exception. Testnet3 and testnet4 are not enabled.

Signet blocks are authorized by a signature in the coinbase transaction (BIP
325), which an 80-byte header does not carry, and signet's proof of work is
tiny: about 2 x 10^8 hashes per block in November 2026, under a minute for one
processor core. So on signet the relay requires both. A signet header is
submitted with `signetHeaders`, together with its raw coinbase transaction and
the coinbase's Merkle branch; the plain `headers` action refuses on a signet
relay. For each header the core library:

- checks that the coinbase is leaf 0 of the header's Merkle tree (64-byte
  transactions and branches deeper than 32 are refused, as for deposits);
- cuts the signet solution out of the witness commitment exactly as Bitcoin
  Core does and recomputes the Merkle root with the modified coinbase under the
  same branch;
- builds BIP 325's `to_spend` and `to_sign` transactions, which commit to the
  block's version, previous hash, transactions and time;
- verifies the solution against the network's challenge.

`network = "signet"` is the default signet: the challenge is Bitcoin Core's
`SIGNET_DEFAULT_CHALLENGE`, a bare 1-of-2 `OP_CHECKMULTISIG`. That template
(bare m-of-n multisig, signatures in the scriptSig, empty witness stack, strict
DER, empty dummy element) is the only one implemented; other signets are not
supported. The proof is checked and discarded; only the header is stored. Up
to 16 signet headers per action; in every block observed the coinbase is 261
bytes and the branch at most nine hashes.

In the browser, header sync on a signet relay makes four requests per block to
the configured Esplora-compatible source: `/block-height/:h`,
`/block/:hash/header`, `/block/:hash/txids` and `/tx/:coinbase/hex`. The
coinbase's Merkle branch is computed from the transaction IDs and checked
against the header before anything is submitted (`ui/src/bitcoin.ts`), so a
wrong answer from the source costs a message, not a failed transaction. Headers
go through the wallet as `btcrelay.signetHeaders`, 16 per action and at most 64
blocks per sync. The source is `bitcoin_api` in the deployment's `config.json`;
without one the UI falls back to `https://mempool.space/signet/api` on signet
and `https://blockstream.info/api` on mainnet, and a user can set another.
`npm test` in `ui` checks the proof assembly against the fixtures of the core
tests.

What remains trusted on signet is its two signers, as for every signet node.
A header with valid proof of work and no valid signature is refused, so header
submission is permissionless on signet as on mainnet. The signature does not
cover `bits` or the nonce; the relay's exact-difficulty and proof-of-work
rules cover those.

The creator must select a genuinely trusted Bitcoin checkpoint; for mainnet use
a recent independently verified checkpoint. A recent-looking low-work branch
from genesis is not an adequate bootstrap security policy. The relay knows only
the branches submitted to it and requires honest, timely relay participation.
Headers plus inclusion proofs are SPV, not full transaction/UTXO validation.

Confirmation count includes the containing block. The demo requires seven
confirmations for both deposit issuance and withdrawal completion. The depth is
set at initialization. The relay's own account can change it afterwards with
`setRequired`, within the same range (1 to 144): on mainnet it can only be
raised, never lowered; on signet and regtest any value in range is accepted. No
keeper or other account can change it.

The bridge's custody policy is likewise set at `init`. On a test network
(signet, regtest) the bridge's own account can change two of its values with
`setTestMins(min_deposit, min_withdrawal)`: the smallest deposit and the
smallest withdrawal, each at least 1,000 sat, and the smallest deposit at least
what its custody output costs to spend (105 vB at the policy's fee rate). It is
refused on mainnet, where the minimums are fixed at initialization, and it
cannot change the network, the custody keys, the fee rate and its cap, the
service fee, the dust limit or the batching limits. A request queued before a
change is still paid: the minimum is the rule for new requests, and a batch
enforces only the fixed 1,000 sat floor. Everything else about a queued request
is judged when its batch is made (fee rate, dust, batch size), except the
service fee and fee allowance, which it keeps from when it was made.

A withdrawal's network fee is not taken from the amount. The recipient receives
the amount; the requester sets aside the amount, a fee allowance (`max_fee`)
and the service fee, and the unused allowance comes back. A batch with one
request and one custody input is budgeted at 190 vB to a P2WPKH address and 202
vB to a P2TR or P2WSH address (380 and 404 sat at 2 sat/vB); a second request
adds 31 or 43 vB and the fee is shared; each further input adds 105 vB.
`withdraw` refuses an allowance below the least share the request could ever be
charged (a full batch with one input: 221 sat to P2WPKH at 2 sat/vB with
batches of two). A larger allowance that still proves too small when the batch
is made sets the request aside for its owner to cancel; it does not hold up the
queue. The bridge always keeps at least `dust` as change, so from a reserve of
one 10,000 sat output at most 10,000 - 380 - 1,000 = 8,620 sat can be paid out.
A request the reserve cannot pay that way is not set aside: `makeBatch` fails
while it is at the head of the queue, until deposits arrive or its owner
cancels it.
Accepted transfers protect their Bitcoin history. A higher-work reorg removing
that history, or exceeding the bounded update window, persistently freezes the
relay. A stale tip stops new credit and withdrawal authorization. A pause cannot
revoke a signature request that was already authorized and finalized.

## Token and UTXO accounting

A deposit's raw transaction, selected output and Merkle branch must match a
confirmed canonical header. Coinbase deposits and 64-byte stripped transactions
are excluded; the latter avoids Bitcoin's leaf/internal-node Merkle ambiguity.
Payload sizes and proof depth are bounded. Every accepted `(txid,vout)` remains
recorded permanently, including after spending. Bridge-originated change and
consolidation outputs cannot be credited as new deposits.

The tracked reserve includes confirmed available and reserved bridge UTXOs.
Inclusion alone does not prove an output is still unspent. Accounting assumes
that custody keys spend through this protocol; anyone can prove an unexpected
spend and freeze the bridge. Sparse proofs do not establish completeness of the
Bitcoin UTXO set or a complete reserve audit.

A withdrawal locks `recipient amount + maximum miner fee + service fee` in a
native token subaccount. Only the requester can cancel, and only before batch
commitment. Inputs are reserved atomically when a deterministic batch is made.
Once committed, withdrawals cannot be cancelled or refunded on a timeout.

After confirmed payment, input rows become spent and confirmed change becomes a
new available UTXO. The recipient amount and actual miner fee are burned. Unused
network allowance is credited back, and the service fee is transferred as an
existing backed token. This preserves:

```
tracked reserve = bridge-issued liability
native withdrawal subaccount = sum of locked request allowances
native token current supply <= bridge-issued liability
```

The supply inequality permits voluntary user burns. Mint administration remains
owned by the bridge contract because new proven deposits must remain issuable.
The token is unrecallable. The current exchange's immutable-admin requirement
therefore admits it for **spot trading**, while excluding it from margin/lending.
It is a separate token from the exchange demo's pre-issued mock BTC.

## Batches and fee replacements

A public caller can make a batch when the oldest pending request has waited five
minutes or the request-count threshold is reached. The demo threshold is two;
the policy permits up to 32. There are separate input and concurrent-batch limits.
Five minutes is a batching window, not a Bitcoin confirmation promise. Contracts
need a caller; they do not wake themselves on a timer.

A fee replacement is allowed after five minutes, raises the authorized fee rate,
retains every input and payment, reduces change, and respects all original fee
caps. There are at most eight replacements. Any registered revision may complete
the batch once, even if a newer revision exists. No timeout releases its inputs.
An economical change output is required; dust is never silently donated. UTXO
consolidation and key rotation are not exposed in this initial implementation;
there is no discretionary sweep API or emergency confiscation action.

## Running locally

Prerequisites: this repository's native Psibase tools, Rust and its WASI target,
a WASI C compiler, Node/npm, Python 3, and Bitcoin Core 32.1. The current local
checkout already has the native tools and a SHA256-verified Bitcoin Core archive.
The Bitcoin executables are under `demo/btcbridge/bin/bitcoin-32.1/bin` and may be
overridden with `BTCBRIDGE_BITCOIN_BIN`.

```sh
python3 demo/btcbridge/run.py build
python3 demo/btcbridge/run.py setup
python3 demo/btcbridge/run.py status
python3 demo/btcbridge/run.py mine
python3 demo/btcbridge/run.py relay
python3 demo/btcbridge/run.py stop
```

The default native node is port 8091, the origin-restricted Bitcoin data and broadcast gateway is port 8092, and Bitcoin regtest RPC is 18453. All listeners are
loopback-only. P2P discovery is disabled. State and disposable signing secrets are
ignored under `demo/btcbridge/state`. Setup does not reset an existing chain.
The original running exchange's ports and state are preserved.

Open `http://btcbridge.psibase.localhost:8091/`. The UI derives every displayed
address from the three public roots, detects deposits, submits proofs, requests
hash signatures, gathers responses and broadcasts completed Bitcoin transactions.
It can use a configurable HTTPS Esplora source instead of the local test gateway.
Closing all participating browsers stops this public coordination unless a
keyless relayer runs `relay`. The signing daemons continue monitoring Psibase.
`mine` advances seven Bitcoin blocks and runs public coordination; regtest does
not mine on its own. The test faucet only operates against Bitcoin regtest.

The app connects through Psibase Supervisor and the native Accounts/AuthSig wallet.
There is no wallet selector, server-side impersonation endpoint, faucet, or mining
control in the app. Accounts must use `auth-sig`; both the UI and native bridge
plugin verify this before scheduling actions. Supervisor selects the current
account, obtains its claim and proof, and submits the signed atomic transaction.
The bridge plugin exposes a bounded allowlist and only permits token settlement
with `btcbridge` using the configured bridge token. It does not expose deployment,
key-administration, arbitrary sender, or arbitrary token-transfer operations.

The plugins build against the tree's own wallet interfaces (`host:accounts`,
`host:http`, `host:client`, `accounts:query`, `transact:plugin`, `tokens:plugin`,
`permissions:plugin`); there are no local copies. `Accounts`, `Host`,
`Transact`, `Tokens`, and `Permissions` must be direct package dependencies so
DynLd can resolve their namespaces.

The page has no account controls of its own. Its header mounts the account menu
every app shows (`packages/shared-ui/components/account-menu`): who is signed
in, profile, accounts and keys, switch account, log out, or sign in. Those lead
to the network's sign-in app and return to the page, which then asks the wallet
who is signed in and shows only that account's address, balance and requests.
The deposit panel can read the signed-in account's contacts, with permission,
through the permissioned `profiles:plugin/contacts` API to deposit for a
contact: selecting one fetches that account's registered deposit address and
independently derives it from all three custody roots. Contacts and profiles
are edited in the home app. A contact without a registered deposit address must
create one while signed in to their own account.

The menu is a React component styled with shared-ui's Tailwind stylesheet; the
rest of the page is plain TypeScript with its own CSS. `ui/build.mjs` bundles
the menu from the tree (nothing is copied), compiles the shared stylesheet,
leaves out its page-wide base layer and keeps the page's rules in a CSS layer
beneath it, so the menu looks as it does elsewhere and the page is unchanged.

Local operator credentials are mode-0600 P-256 PEM files under the mode-0700
`state/account-keys` directory. Every user, provider and administrator has a
distinct key. Service accounts retain delegation to the secured administrator.
These generated local credentials are for this isolated chain; live deployments
use user-controlled account keys and independent provider operators. Import an
existing local account through the native wallet's sign-in screen. Its released
UI expects the base64 body of the PKCS#8 private key, without the PEM wrapper.
Never publish or embed these credentials in app assets.

Bitcoin endpoint configuration is public deployment data in `/config.json`;
there is no separate development UI. `run.py mine` and direct Bitcoin Core RPC
are developer-only tools. The gateway only exposes chain reads and raw Bitcoin
broadcasts. Retired wallet/faucet endpoints return HTTP 410, including the old
isolated exchange adapter writes. The separate original exchange is unchanged.

## Verification and deployment limits

```sh
cargo test --manifest-path packages/user/Cargo.toml \
  --target aarch64-apple-darwin -p btcbridge-core -p signing-core
python3 demo/btcbridge/test_e2e.py
```

Host tests cover transaction conservation, deterministic selection, fee limits,
all signer pairs, modified-payment signature rejection, Merkle proof tampering,
target encoding, a historical mainnet difficulty transition, a real signet
retarget, and signet block signatures against real blocks from both signers and
against re-mined forgeries with valid proof of work. E2E tests use
actual Bitcoin Core and Psibase nodes, including generic key ownership,
confirmation depth, native issuance, signer outage, withdrawal settlement,
replays, account-signature enforcement, retired endpoint rejection, browser-origin restrictions and reorg handling. They use separate
ports/state and intentionally freeze the test relay at the end. Use a fresh test
state directory for another run; never point these tests at user funds.

This is an implementation for regtest validation, not an audited mainnet custody
deployment. Mainnet launch additionally needs independently operated providers,
reviewed governance and key lifecycle, provider resource economics, custody
recovery procedures, performance qualification at the configured limits and an
independent security audit. No real BTC is required or used by the demonstration.

## Explorer and public proof publishing

The main interface contains deposit, withdrawal, transaction-ID recovery, personal
activity, and links to the native token wallet. Detailed public inspection lives
at `/#explorer/batches`, `/#explorer/utxos`, `/#explorer/withdrawals`,
`/#explorer/deposits`, and `/#explorer/addresses`. A batch link such as
`/#explorer/batch/2` shows every reserved input, provider, requested hash, signature
progress, transaction revision, miner fee, change amount, and included withdrawal.
It distinguishes finality, requests not yet published, provider signatures,
collection/assembly, broadcast, confirmations, and confirmed proof settlement.

Fully signed transaction bytes come from Psibase. Anyone can broadcast the latest
authorized revision through the configured Bitcoin source, including an observer
without a connected wallet. Mempool and confirmation observations from that source
are advisory and never set an on-chain broadcast or completion flag. Completion
requires a verified canonical proof at the configured confirmation depth.

Deposit recovery independently parses Bitcoin transaction bytes and checks the
requested txid. It matches output scripts through the public on-chain address
registry, independently derives the registered address from the three public
roots, and preserves the bound recipient even when another account publishes the
proof. The browser relays missing headers first and checks canonical depth before
submitting the Merkle proof. The contract independently repeats all proof and depth
checks. Pasting an unconfirmed transaction permits inspection, never issuance.

The approved initial fee is 10 basis points (0.10%), with 5,000 basis points
(50%) of that fee paid to the first valid proof publisher. For a 1 BTC deposit,
0.999 BTC credits the recipient, 0.0005 BTC pays the publisher, and 0.0005 BTC pays
the treasury. All amounts are integer satoshis, rounded down; the treasury receives
the fee remainder. The full gross amount remains Bitcoin backing for the full
native token issuance. A publisher may also be the recipient. A permanent outpoint
record prevents replay and makes fee splitting and issuance atomic. There is no
extra mint for the bounty. Front-running another publisher's public proof is
possible by design: first valid confirmed proof wins, as requested.

`setDepFees(fee_bps, publisher_bps)` requires the bridge's administration authority.
The initial policy is set once during deployment; later updates have a 24-hour
announcement period. Deposit fees are capped at 1%; the publisher's share cannot
exceed the collected fee. The snapshot exposes effective and announced terms.
Each deposit stores its actual terms, credit, publisher, fee, and reward.

Tables 11 and 12 add fee policy and deposit history without changing existing
record layouts. `indexDeps(after, limit)` is a bounded, permissionless migration
from permanent deposit UTXOs to earlier history. It never mints, moves tokens, or
pays a reward. Earlier rows are explicitly marked legacy with zero deposit fees
and unknown publisher/time. Already indexed records are unchanged.

Public JSON endpoints (GET, no authentication):

- `/addresses?after=0&limit=100`: inclusive ascending address registry pages;
  continue with the returned `next` value. Maximum 200 rows.
- `/deposit-address?script=0020...`: exact registered deposit-script lookup.
- `/explorer/addresses?limit=25&cursor=...&owner=alice`: ascending directory.
- `/explorer/utxos?limit=25&cursor=...&status=all`: statuses 0 available,
  1 reserved, 2 spent. Outpoints, owner/address binding, and deposit receipt.
- `/explorer/deposits?limit=25&cursor=...&owner=alice`: descending confirmed
  deposit history. `/explorer/deposit?outpoint=TXID-VOUT_HEX` reads one receipt;
  VOUT_HEX is eight hexadecimal digits.
- `/explorer/withdrawals?limit=25&cursor=...&owner=alice`: descending requests
  including queued, committed, complete, cancelled, and fee-deferred states.
- `/explorer/batches?limit=5&cursor=...&status=0`: pending by default, 1 complete,
  or `all`. Maximum ten batches per page.
- `/explorer/batch?id=2`: full public transaction and per-input signing detail.
- `/explorer/transaction?txid=...`: registered bridge transaction lookup.

Explorer pages use exclusive cursors, unlike the original inclusive `/addresses`
API. `next: null` ends a list. Most explorer endpoints cap pages at 50 records.
Filters and cursors are validated; queries avoid unbounded scans and counts.
History is public by design. An explorer cursor does not freeze the entire live
chain into one snapshot; changing UTXO status can change status-filtered pages.

## Independent public coordinator

`demo/btcbridge/relayer.py` is a separate public proof and broadcast process. It
scans a bounded page of public deposit addresses, publishes confirmed deposits,
coordinates deterministic signing requests, broadcasts signed withdrawals, and
posts confirmed completion proofs. It never loads Bitcoin custody seeds. The
generic signing daemons still have no Bitcoin dependency or Bitcoin connection.
The coordinator uses its own authenticated Psibase account and receives any
first-publisher rewards it earns. The local default is Alice; set
`BTCBRIDGE_RELAYER_ACCOUNT` and optionally `BTCBRIDGE_RELAYER_KEY` to another
operator's account and PEM-key path. Production operators can replace this local
Core RPC adapter with an independent Bitcoin source.

`run.py start` starts this coordinator by default. Set `BTCBRIDGE_AUTO_RELAY=0`
to test the browser-only fallback; adversarial E2E tests do so explicitly. Stop
includes this process. `run.py mine` remains a developer-only regtest command.
Deployment assets/configurations are staged separately under each environment's
`ui-public` directory so parallel test nodes cannot change the live Bitcoin URL.
The HTML cache identity includes its deployment CSP, preventing stale source
permissions after a package reinstall.

## Required prunable verification boundary (not yet migrated)

Prunability is a format and execution requirement now; implementing historical
proof garbage collection is deferred. The bridge must put bulky witnesses in
`SignedTransaction.proofs`, with compact, exactly bound claims in the signed
transaction body. Keeping witnesses in action arguments or claim payloads would
make them part of permanent transaction data and does not meet this requirement.
Parallel admission verification and rejection of invalid evidence before
objective execution are required for resilience against expensive invalid
submissions and for efficient replay. This is not merely an optimization to add
after deployment.

The current bridge still parses and verifies Bitcoin evidence in its objective
actions. Psibase account authentication already uses the proof pipeline: the
released Transact implementation schedules `XRun::verify` asynchronously, and
verified execution tokens can avoid repeating proof work during application.
`isVerify` services have objective database access disabled. This supports a
future verifier that checks raw transaction parsing/txids, Merkle inclusion,
proof of work, and secp256k1 signatures without reading mutable bridge state.

Such a verifier must bind its compact claim to every fact used by the action:
version/domain, deployment and network, block hash, txid, relevant inputs, output
index/script/value, or an authorized transaction commitment. Merely attaching an
unrelated valid Bitcoin proof is insufficient. The objective action must require
that exact verified claim and still check the canonical chain, accumulated-work
selection and difficulty context, depth, registered recipient, bridge-origin
inputs, replay tombstones, UTXO reservation, fee policy, and accounting atomically.
Invalid signatures, malformed witnesses, and invalid Merkle paths belong in the
context-free rejection path. Their cryptographic validity is deterministic;
subjective admission limits (size, work, timeouts, and queuing) may additionally
protect individual nodes. A node-local successful-verification token is a cache,
not a trusted assertion another node may accept without verification. Objective
execution must never accept an absent or failed required proof.

The wallet/transaction builder also needs an interface for attaching non-wallet
proof payloads; the existing extra-signature path is not a generic Bitcoin proof
API. No bridge bypass or trusted-verifier flag has been introduced.

Bulky raw transactions and Merkle branches could then live in transaction proof
payloads instead of action arguments, leaving compact commitments in the signed
transaction and only durable UTXOs/receipts in objective storage. Custody
signatures needed to assemble/broadcast a Bitcoin transaction remain public
application output until their lifecycle permits removal. Pruning historical
proof payloads requires irreversible inclusion plus an explicit checkpoint or
archive/replay policy. A node replaying from genesis still needs historical
witnesses, or a separately justified state/checkpoint synchronization mechanism;
prunability alone does not establish proof-free trustless synchronization. This
checkout still marks SignedTransaction proof pruning as a TODO. Implementing that
pruner is outside the current requirement; wiring the bridge and transaction
builder to this boundary remains outstanding.
