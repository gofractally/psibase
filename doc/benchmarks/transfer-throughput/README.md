# Transfer throughput: team `main` to `bytemaster/head`

Measured 2026-11-22 and 2026-11-23 on one x86-64 cloud server that was otherwise
idle, with the wasmtime engine. Raw output for every figure is in [raw/](raw/).

Two measurements are used throughout.

- **Tester**: `psitest TransferBench-test.wasm`. N transactions are pushed into
  one block on one thread. It measures the cost of executing a transaction; it
  is not network throughput. Each case was run three times and the range is given.
- **Network**: one `psinode` producing blocks, a load generator on the same
  machine submitting over HTTP on 16 or 64 connections for 20 seconds, counting
  transactions that were applied in blocks. One run per case.

A "do-nothing" transaction calls an action that does nothing. It pays for
authentication, billing and per-transaction bookkeeping and nothing else.

## Tester, 5,000 transactions in one block (transactions per second)

| | team `main` | 44c57f739 | c45c060cd | 054a0c386 | increase |
|---|---|---|---|---|---|
| Unsigned transfer | 157–159 | 292–301 | 353–366 | 895–900 | 5.7x against `main` |
| Signed transfer, P-256 | 109 | 199–200 | 313–314 | 628–633 | 5.8x against `main` |
| Signed transfer, secp256k1 | not measured | 191–192 | 351–366 | 811–816 | 4.2x against 44c57f739 |
| Do-nothing, unsigned | not measured | not measured | 590–661 | 1,790–1,794 | 2.8x against c45c060cd |
| Do-nothing, secp256k1 | not measured | not measured | 592–609 | 1,490–1,499 | 2.5x against c45c060cd |

The team `main` column was measured a day earlier than the other three, with the
released SDK of `main` (db601e572). The other three columns were measured in one
session.

## Network, one node (transactions applied per second)

| | team `main` | 44c57f739 | c45c060cd | 054a0c386 | increase |
|---|---|---|---|---|---|
| Unsigned, 16 connections | 108 | 197 | 250 | 485 | 4.5x against `main` |
| Unsigned, 64 connections | 108 | 193 | 250 | 405 | 3.7x against `main` |
| Signed secp256k1, 16 connections | not measured | 165 | 224 | 306 | 1.9x against 44c57f739 |
| Signed secp256k1, 64 connections | not measured | 172 | 233 | 305 | 1.8x against 44c57f739 |

Team `main` signed with P-256: 99 at 16 connections and 101 at 64. P-256 over
the network was not measured at the three later commits.

## What each commit adds

- **44c57f739**: wasmtime as the execution engine, psitri as the store, and a fix
  for a store lock held during subjective commits.
- **c45c060cd**: a lean signature verifier (libsecp256k1 and BearSSL in place of
  Botan), secp256k1 as the default key curve, reuse of wasm instances, and a CPU
  deadline enforced by the watchdog thread without a clock read per check.
- **054a0c386**: a write session keeps its changes aside and merges them into the
  store once per block; events are indexed once per block instead of twice in
  every transaction; the store's clock thread wakes once a millisecond.

Measured separately on the 44c57f739 base, tester, 5,000 unsigned transfers:
300–308 with neither change, 346–351 with the write-session change, 646–654 with
per-block event indexing added
([raw/x86-tester-transaction-stack.txt](raw/x86-tester-transaction-stack.txt),
[raw/x86-tester-event-indexing.txt](raw/x86-tester-event-indexing.txt)).

## Read these numbers with care

- With events indexed per block, indexing time is no longer part of a
  transaction's billed CPU. An objective price for events is not built yet.
- A transaction's events become visible to queries when its block is finished.
- The tester has been observed to verify each signature twice. That was not
  rechecked at 054a0c386.
- The network figures are from a single node with the load generator on the same
  machine. No multi-node run was made at c45c060cd or 054a0c386.
- Signed network throughput rose less than unsigned.

## Reproducing

[raw/full_run.sh](raw/full_run.sh) is the script that produced the three later
columns; its paths are those of the server it ran on. The benchmark itself is
`packages/user/Tokens/test/src/TransferBench.cpp`; each run prints `BENCH` lines,
which are what the `raw/*.txt` files hold.
