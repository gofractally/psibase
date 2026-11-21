# Ethereum relay and ETH bridge

A development implementation of the Bitcoin bridge architecture using Ethereum
beacon finality, context-free evidence verification, and a fixed 2-of-3 ETH vault.
No real funds or existing exchange/BTC chain state are used by its tests.

## Evidence and objective state

`../EthRelay/verify` is the `verify-eth` **isVerify** service. It reads no database,
writes no database, and calls no other services. It checks:

- Deneb/Electra/Fulu beacon header, execution payload and committee SSZ proofs.
- Ethereum sync-committee BLS12-381 signatures, fork domains, canonical points,
  subgroup/infinity rules, and the 342/512 supermajority threshold.
- Canonical RLP execution headers and bounded Merkle-Patricia account/receipt
  membership, successful receipt status, and exact log positions.

Its claim is a 32-byte, domain-separated commitment to the resulting fact.
The witness is in the transaction's **proofs**, outside the objective action.
An objective consumer recomputes that commitment and requires the matching
`verify-eth` claim in the executing transaction. It then binds the fact to its
actual frozen network, current/next committee, checkpoint or execution root.
Proof verification does not get to choose those trusted roots.

Ethereum evidence is intentionally portable between Psibase transactions: the
external Ethereum signature cannot sign a Psibase transaction hash. Account
signatures still authenticate the complete Psibase transaction, including its
claims and actions. Application-level slot progression, deposit IDs and batch
nonces prevent evidence replay from issuing or settling funds twice.

`ethrelay` advances authenticated committee/finality state and retains a bounded
ring of execution roots. `backfill` authenticates an older RLP execution header
by matching its hash/number to an already authenticated child's parent. Receipt
proofs must reference a root in that retained, finalized ancestry. A finality
update alone does not authenticate every intervening execution block.

The initializer must select an independently trusted recent checkpoint and
correct genesis/fork configuration. Initialization is one-time. The frozen
trust policy permits at most seven committee periods without progress, and a
separate freshness window gates bridge operations. There is no timeout-forced
or optimistic finality path. Same-slot contradictory signed finality or known
next-committee roots freeze the relay. The security assumption remains
Ethereum's light-client sync-committee/finality model, not full execution or
full validator-set revalidation.

## Computational qualification

The earlier `experiments/eth-relay` benchmark measures a monolithic BLS check.
Its multi-second interpreter cost is **not** charged to the new objective state
transition: native proof verification is a separate execution context before
objective admission. This layout permits independent parallel preverification.
It does not implement a parallel scheduler or the planned faster Mac engine;
the existing block replay path still has a concurrency TODO.

The current node's default proof-admission watchdog is **200 ms**, separate
from the default **196 ms** objective block budget. The old arm64 interpreter
exceeds that proof watchdog. Production admission on the intended new engine
still needs qualification, including total proof throughput, malformed-input
costs and producer resource policy. No default watchdog or billing policy was
relaxed for this package. Native-chain tests run proofs without an admission
watchdog and report proof and objective action times separately.

The test harness previously skipped proof verification when pushing a test
transaction. `programs/psitest/main.cpp` now checks claim/proof counts and invokes
native proof verification before objective execution, so an invalid witness
cannot be accepted merely because its claim is present in a test transaction.
This also makes proof-carrying tests representative of node security checks.

Persistent relay state stores committee **roots**, rather than 512 public keys.
The proof supplies the keys and authenticates their SSZ root. Retained execution
roots are capped by the initialized ring size (16–8192). Transfer replay records
and withdrawal history remain permanent and grow with actual bridge use.
The default WASM linear-memory limit is 32 MiB. Complete engine/resource billing
qualification remains a deployment requirement.

## ETH custody and accounting

`contracts/EthVault.sol` is a minimal Solidity 0.8.30 vault. It has no owner sweep,
upgrade, key rotation, arbitrary-call authority or gas reimbursement mechanism.
Three independent providers use the existing generic `signhash` service.
`ethbridge` owns a distinct key from each provider and uses child path `[0,0]`.
The daemon only sees Psibase key/hash requests and needs no Ethereum RPC.

Initialization requires a finalized account proof of the **compiled runtime code
hash** and the constructor's `Configured` event in the same authenticated block.
The event must match the deployment identity, Ethereum chain ID and all three
bridge-owned derived public keys. The exact Solidity build settings, ABI,
bytecode and runtime hash are retained in `contracts/EthVault.json` and
`contracts/runtime.keccak`.

Deposit via `vault.deposit(uint64 recipient)` with an integral number of 10-gwei token units.
The recipient is the exact Psibase account number, not the proof publisher or an
Ethereum address. Plain ETH sends are rejected. A finalized successful deposit
receipt mints once, with the default 0.10% deposit fee split equally between the
treasury and first valid proof publisher. All units and fees are integers.

The native token uses **8 decimals**, Psibase’s supported maximum, so one unit is 10 gwei. An 18-decimal u64
token would hold at most about 18.446744 ETH in total units. The vault rejects
deposits finer than 10 gwei; the bridge never truncates wei silently.

Withdrawals escrow principal plus the initialized service fee. Queued requests
can be cancelled only by their owner. Batches select request IDs in order after
five minutes or the initialized request threshold (1–32). Only one batch is
outstanding at a time. The contract constructs the exact payments and EIP-712
digest, binding chain ID, vault address, deployment identity, nonce and ordered
address/amount pairs. Signers authorize only finalized generic hash requests.
Two signatures are converted to canonical Ethereum form and ordered by recovered
address; anyone may broadcast the resulting calldata and pay Ethereum gas.

The vault **allocates** signed payments to recipient-specific claimable balances.
Anyone can call `claimFor(recipient)` to deliver those funds to that exact address.
A rejecting recipient leaves its own allocation claimable and cannot block the
whole batch. After a finalized `BatchExecuted` proof, Psibase burns paid principal
and transfers the already backed service fee. There are no timeout refunds of
committed withdrawals. Claim gas is paid by the caller, not taken from reserves.

The checked accounting invariants are:

```
tracked unallocated reserve = bridge-issued liability
native withdrawal subaccount = sum of locked request allowances
native token current supply <= bridge-issued liability
```

Allocated ETH is a direct obligation to the signed Ethereum recipient and no
longer backs a Psibase token. The vault's `allocated` counter prevents a later
batch from reusing it. Sparse proofs are not a complete balance/deposit-history
audit. Custody/governance trust remains comparable to the BTC 2-of-3 design.
The token retains bridge mint administration and is unrecallable; do not describe
it as an immutable-admin margin asset.

## Build and validate

Run from the repository root. Existing prerequisites are Rust/WASI, this
checkout's native tools, Node/npm and the WASI SDK. The explicit SDK variables
below match this development machine; change them for another installation.

```sh
npm ci --prefix demo/ethbridge --ignore-scripts --no-audit --no-fund
npm --prefix demo/ethbridge run build
npm --prefix demo/ethbridge test
cargo run --manifest-path packages/user/Cargo.toml \
  --target aarch64-apple-darwin -p ethrelay-core --features bls --example make_fixture
cargo test --manifest-path packages/user/Cargo.toml \
  --target aarch64-apple-darwin -p ethrelay-core -p ethbridge-core --features ethrelay-core/bls
node demo/ethbridge/test-ui.mjs
cmake --build build --target psitest -j 2
CC_wasm32_wasip1=/Users/dlarimer/psibase/build/wasi-sdk-prefix/src/wasi-sdk/bin/clang \
AR_wasm32_wasip1=/Users/dlarimer/psibase/build/wasi-sdk-prefix/src/wasi-sdk/bin/llvm-ar \
rust/target/release/cargo-psibase psibase --manifest-path packages/user/Cargo.toml \
  --psitest build/psitest -p ethbridge test
```

The native-chain tests exercise actual proof-mode verification, missing and
unrelated claims, invalid proofs, committee rotation, minting, first-publisher
fees, deposit replay, escrow, committed cancellation rejection, generic signing,
EIP-712/calldata parity with the EVM fixture, finality settlement and settlement
replay. The beacon commitments in these E2E fixtures are synthetic, with real
BLS signatures wrapped around real Ganache execution receipts/account proofs.

Separately, saved real mainnet Fulu bootstrap/finality evidence is verified by
native tests. `demo/ethbridge/mainnet-source.json` records its RPC source and
`mainnet-verification.json` records independently checked facts. That RPC-supplied
checkpoint is a test anchor, not an independently authenticated mainnet launch
checkpoint. Tests do not need live network access. To refresh that evidence:

```sh
python3 demo/ethbridge/fetch-mainnet-fixture.py
```

Build the package with `-p ethbridge-pkg package` instead of `-p ethbridge test`.
It produces `packages/user/target/wasm32-wasip1/release/packages/EthBridge.psi`.
The package includes the verifier, relay, bridge, paginated query service,
native wallet plugin and browser app. No package is installed on an existing
node by these commands.

## Permissionless proof submission

The relayer uses a submitter's **Psibase auth key**, never an ETH custody key.
Build it independently:

```sh
cargo build --manifest-path packages/user/EthBridge/relayer/Cargo.toml \
  --target aarch64-apple-darwin --target-dir packages/user/target
```

`ethbridge-relayer inspect witness.json` checks a witness and prints its fact and
commitment. `demo/ethbridge/bundle.py` prepares reviewable update/deposit/complete/
backfill actions with those exact facts. Then submit a bundle:

```sh
packages/user/target/aarch64-apple-darwin/debug/ethbridge-relayer \
  submit http://psibase.localhost:PORT/ bundle.json relayer-auth-key.pem
```

The bundle contains `actions` and `witnesses`; witnesses are verified locally,
then included as proofs of `verify-eth` claims alongside ordinary account
signatures. Local verification happens before the transaction's TAPOS window.
Auth key files must be private regular files (0600). This is a developer/client
transport, not a server-side account impersonation endpoint.

`demo/ethbridge/receipt-proof.mjs` constructs a receipt witness from an untrusted
execution RPC and recomputes the block's receipt trie. The objective relay still
must authenticate that block's receipts root. RPC assertions alone never credit
funds. Use the log's index **within its receipt**, rather than the block-wide
RPC `logIndex`. `fetch-mainnet-fixture.py` demonstrates converting beacon API
objects into SSZ witness fields; a persistent public keeper/endpoint policy is
not deployed by this change.

## Browser and remaining deployment work

The app connects through native Supervisor/Accounts/AuthSig. Its wallet plugin
allows only this bridge's token transfers, withdrawals, queued cancellation,
batch formation and signature gathering. It does not expose administration,
arbitrary senders or general token transfers. The app constructs integral-10-gwei
Ethereum deposits, shows paginated deposits/withdrawals/batches, broadcasts signed
calldata, and permits anyone to collect recipient allocations.

Browser financial-flow tests mock the wallet transport and check exact integer,
recipient, calldata and atomic authorization encoding. They do not establish an
installed wallet-session E2E result. Proof submission currently uses the CLI;
the pinned released Transact browser interface cannot append arbitrary evidence
proofs. Browser-only proof recovery needs that native wallet API extension.
Public JSON emits u64 values above JavaScript's exact integer range as decimal
strings; browser transaction amounts use lossless integer encoding.

The UI's native WIT is deliberately pinned to the same released 0.29 interfaces
as BtcBridge; update the runtime and pinned bindings together.

No live vault, custody providers or continuous keeper are provisioned here.
A mainnet launch still requires intended-engine admission/throughput tests,
reviewed bootstrap/fork configuration, independent provider operations, browser
wallet E2E qualification, a keeper/recovery policy, and an independent audit of
both the vault and proof/state binding. The implementation does not claim those
remaining deployment steps have been completed.
