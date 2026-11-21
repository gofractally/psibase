# Ethereum relay and ETH bridge feasibility

This is a resource qualification experiment for adapting the existing
`packages/user/BtcRelay`, `BtcBridge`, and `Signing` design. It is **not** a
working Ethereum relay, custody contract, bridge package, or deployment.

The user requested the full ETH deposit/withdrawal bridge if it fits Psibase's
computational and storage constraints. The initial experiment measured a monolithic objective BLS verifier. That path
exceeds the default sequential block CPU budget on Apple Silicon. The user
subsequently clarified that expensive checks belong in context-free evidence
verification, outside objective execution and suitable for parallel processing.
The implementation now follows that architecture in `packages/user/EthRelay`
and `EthBridge`; this benchmark does not establish its objective CPU cost.
Nothing is installed on the exchange or BTC bridge chains.

## Reproduce

From the repository root:

```sh
python3 experiments/eth-relay/run.py
```

Dependencies: Rust with `wasm32-wasip1`, a WASI SDK, Binaryen `wasm-opt`, and this
checkout's `build/psitest`. The script accepts `--psitest`, `--wasi-sdk`, and
`--repeats`. Wasmtime, when installed, is measured separately for comparison;
it is **not** the Psibase VM and its result does not qualify a Psibase deployment.

The standalone Cargo workspace and lockfile isolate the experiment from the
active exchange/BTC package workspace. It does not provision services, generate
custody credentials, start nodes, or change existing chain state. The fixture
contains public BLS keys and signatures made with deliberately public,
deterministic test material; it is never a custody key source.

`src/main.rs` uses pinned `blst` 0.3.17 with Ethereum's
`BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_POP_` ciphersuite. It measures:

- 342 participants: the minimum two-thirds supermajority of 512.
- 512 participants: a fully participating committee.
- A preaggregated-public-key signature check: deliberately excludes committee
  authentication, bitfield processing, key decoding/aggregation, SSZ, storage,
  transaction decoding, and other bridge work. This establishes a lower bound
  for this library's one-transaction verification path.
- Committee decoding plus aggregate signature verification, with and without
  individual public-key subgroup checks. The unchecked variant is only an
  optimistic resource estimate for already authenticated canonical validator
  keys, not a recommendation to accept arbitrary unvalidated keys.

The signature and aggregate-key bytes are generated on the host and embedded
before the WASM build, so key generation and signing are outside every timed
measurement. All timings include process CPU microseconds and elapsed
microseconds; CPU is the relevant comparison with Psibase's CPU allowance.
Wrong messages, wrong signature domains, infinity signatures, and invalid point
encodings must be rejected on every measured engine. This is a synthetic BLS
fixture, not an Ethereum consensus-spec vector, bootstrap, or end-to-end proof
of Ethereum finality.

`results/feasibility.json` records the machine, compiler, Psitest binary hash,
WASM size, fixture hash, samples, medians, and rejection checks. Raw outputs are
in the adjacent logs. WASM lowering normalizes Rust's reference-type encoding,
sign-extension and memory-copy/fill operations for the installed VM; this does
not replace the cryptographic algorithm.

## Source-derived resource limits

The current checkout's defaults are:

- `packages/system/VirtualServer/service/src/tables.rs`: replay factor 5 and
  20,000,000 ns reserved for block system work.
- `tables/network_specs.rs::derive_cpu`: `(1,000,000,000 - 20,000,000) / 5`
  = **196,000,000 ns (196 ms)** of block CPU. An actual network may configure
  different values; this is a default, not a protocol-wide immutable limit.
- `VirtualServer::get_cpu_limit`: transaction allowance is capped by block CPU
  and available resource balance. Buying more resource tokens does not bypass
  that configured block cap. Billing-disabled local tests do not demonstrate
  production admission under billing.
- `libraries/psibase/common/include/psibase/block.hpp::VMOptions`: default
  linear memory **32 MiB**, and total WASM stack **1 MiB**.
- At the time of this benchmark, native execution used EOS VM with JIT on
  x86-64 and the interpreter on arm64. The psizam migration changes node and
  psitest execution to `psizam::jit_profile` on both architectures. These
  historical timings must be measured again before using them for admission
  decisions; the proof-admission budget remains 200 ms.

An oversized one-transaction BLS verifier cannot be fixed merely by submitting
updates less often: its peak cost still must fit one transaction/block. The
benchmark does not prove every possible implementation is infeasible. In
particular, a carefully designed, resumable cryptographic verifier could split
work across transactions, but requires authenticated continuations, bounded
staging storage, spam controls, and independent cryptographic review.

## Storage assessment

A sync committee serializes as `512 * 48 + 48 = 24,624` bytes. Current and next
committees together need **49,248 bytes** before record overhead. Keeping only
their authenticated SSZ roots reduces persistent storage further but requires
resubmitting/authenticating the public keys during updates. Neither approach
requires storing Ethereum's validator registry, execution state, or full chain.

A bounded ring of finalized beacon/execution roots and authenticated historical
headers can limit relay state. A bridge must also retain permanent deposit and
withdrawal replay records, so total bridge storage grows with transfers; a
bounded header ring does not make the entire bridge constant-space. Transaction
history and code/module overhead still need measured qualification. The small
committee representation is an architectural size calculation, not a claim
that a complete bridge has passed Psibase's memory or storage limits.

## Full bridge design after the compute gate

The BTC design's separation of permissionless relaying, deterministic
withdrawals, and generic signers carries over. The following changes are needed:

1. **Ethereum consensus:** initialize once from an independently trusted recent
   beacon block root, genesis validators root, genesis time, and supported fork
   schedule. Authenticate the current committee against that root. Verify
   SSZ branches, signature-slot fork domains, a 342/512 supermajority, finalized
   checkpoints, and current/next committee transitions. Reject skipped unknown
   committee periods, future signature slots, unsupported forks, and expired
   trust policy. Do not use optimistic or timeout-forced headers to issue funds.
   Ethereum requires a recent trust anchor because proof of stake has
   long-range/weak-subjectivity considerations; Bitcoin accumulated-work fork
   choice does not carry over.
2. **Execution evidence:** authenticate each accepted execution payload root
   against the finalized beacon body. Authenticate its block hash, state root,
   and receipts root. A finality update does not automatically authenticate
   arbitrary intervening execution blocks: establish their ancestry via bounded
   authenticated execution-header backfill or appropriate SSZ history proofs.
   Verify canonical RLP/Merkle-Patricia receipt proofs, successful receipt
   status, exact vault address/event ABI, and transaction/log position. RPC
   `confirmations`, `eth_getTransactionReceipt`, or provider assertions alone
   are not deposit evidence. Add official Ethereum vectors, public-network
   fixtures and malformed/adversarial proof tests before accepting funds.
3. **ETH custody:** deploy a minimal, immutable 2-of-3 Solidity vault with
   signer addresses derived from three separately owned generic signing keys.
   Verify the deployed runtime code and immutable configuration through an
   authenticated execution-state account/storage proof; pinning only a familiar
   contract address is insufficient. The vault emits account-bound deposit
   events with monotonic IDs and executes nonce-protected withdrawal batches.
   Ethereum has no native P2WSH equivalent; deriving EOAs from public keys does
   not by itself reproduce Bitcoin's 2-of-3 custody. A shared vault call can
   identify the Psibase recipient; optional counterfactual deposit contracts
   would require additional deployment/gas policy and review.
4. **Deterministic authorization:** Psibase selects requests in fixed order
   after five minutes or a configured count. The signed digest binds the
   Ethereum chain ID, vault address, bridge deployment identity, batch nonce,
   and exact recipient/amount list. Use an EIP-712 domain and a contract-defined
   batch type. Generic daemons only sign hashes finalized on Psibase. Verify
   distinct recovered signer addresses and canonical low-S ECDSA on both chains.
   Any relayer may submit the signed vault call and pay Ethereum gas; the
   outer Ethereum transaction nonce and fee do not change authorized payments.
5. **Accounting:** use integer units. Psibase token quantities are `u64`, so
   18 decimals allow only approximately **18.446744 ETH** total units. A
   practical ETH token uses Psibase's maximum 8 decimals (10 gwei per unit),
   with the vault explicitly rejecting deposits finer than 10 gwei. Do not truncate wei or silently donate dust. Proved
   deposits mint exactly once, including an atomic fee/publisher-bounty split.
   Withdrawals escrow backed tokens; unsigned requests alone can be cancelled.
   Authorized batches are never refunded on a timeout. Burn paid principal
   only after a finalized, authenticated `BatchExecuted` event. Batches and
   deposit IDs remain replay-protected permanently.
6. **Gas and failures:** the vault's principal reserve must not pay arbitrary
   broadcaster gas. Initially let the broadcaster pay gas and charge a fixed,
   bounded service fee; a reimbursement scheme needs its own policy. A batch
   must execute atomically or leave its nonce/payments untouched. Define how
   rejecting recipients are excluded before commitment, or use a reviewed
   pull-payment vault with proved claimable obligations included in reserves.
   There must be no discretionary custody sweep, arbitrary target call,
   upgrade authority, or unbounded gas reimbursement path. Contract balance
   alone is not a reserve audit or proof of complete deposit history.
7. **User experience:** retain the native Psibase account wallet and contacts;
   show exact ETH network/vault/recipient binding; support permissionless
   browser relay and pasted-transaction recovery; expose deposit history,
   queued withdrawals, N/3 signatures, ready-to-broadcast calldata and finalized
   settlement. Label RPC observations separately from verified chain evidence.
   Use paginated queries and bounded proof inputs. Do not publish UI that
   suggests unsupported mainnet deposits are available.

## Interpreting this experiment after separating evidence

- Run this exact fixture with **Psibase's x86-64 JIT**, not a different WASM
  engine, on the intended minimum producer hardware. Then measure complete
  relay transactions at 342 and 512 participation, committee rotation,
  historical proofs and malformed inputs, with billing enabled and explicit
  memory/stack limits. Require useful CPU headroom rather than consuming the
  whole block. No x86 Psibase result is claimed by this experiment.
- Alternatively add an audited native BLS12-381 verification host facility to
  Psibase, with strict input limits, subgroup/infinity checks, resource billing,
  and deterministic cross-platform vectors. Native `blst` timing shows why
  this is promising, but adding a host API is a node/protocol change, not a
  contract-only deployment. It must be implemented and qualified separately.
- A staged verifier is another research route. Moving all verification to a
  daemon or trusting RPC votes changes the security model and does not satisfy
  this relay design. A ZK wrapper is not automatically a solution: its verifier
  and setup/security assumptions must also be qualified against this runtime.

The objective CPU comparison applies only to the monolithic approach. The new
`verify-eth` proof service verifies content-addressed facts without database
access; objective consumers bind their commitments to trusted network/committee/
execution roots and enforce monotonicity and replay protection. Proof admission
has its own watchdog (currently 200 ms by default in `ForkDb`), independently
of the block CPU budget. Faster engines, proof scheduling and admission policy
remain deployment qualification items; proof work is not made free or removed
from consensus validation. The current replay path has a concurrency TODO;
this work does not claim to have implemented a parallel scheduler.

## Primary references

- [Ethereum Altair light-client sync protocol](https://github.com/ethereum/consensus-specs/blob/master/specs/altair/light-client/sync-protocol.md)
- [Deneb execution payload authentication](https://github.com/ethereum/consensus-specs/blob/master/specs/deneb/light-client/sync-protocol.md)
- [Electra light-client proof indices](https://github.com/ethereum/consensus-specs/blob/master/specs/electra/light-client/sync-protocol.md)
- [Ethereum fork configuration](https://github.com/ethereum/consensus-specs/blob/master/configs/mainnet.yaml)
- [Ethereum weak subjectivity guide](https://github.com/ethereum/consensus-specs/blob/master/specs/phase0/weak-subjectivity.md)
- [Supranational blst](https://github.com/supranational/blst)
- [EIP-712](https://eips.ethereum.org/EIPS/eip-712)

References inspected November 21, 2026. Forks, point encodings and SSZ layouts
must be pinned and reverified during implementation; live master URLs are not
an immutable implementation dependency.
