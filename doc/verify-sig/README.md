# verify-sig: measurements and verifier checks

Working material behind the change of the `verify-sig` service from Botan to
libsecp256k1 + BearSSL, kept so the numbers and the security check can be
re-run. Nothing here is built or run by the normal build; the scripts were run
by hand on one machine and contain that machine's layout (a psibase source tree
and wasm build under `$HOME`, wasi-sdk, Homebrew LLVM). Treat them as a record
of what was run rather than as portable tooling.

All timings are from an Apple-silicon Mac that was under heavy load from other
builds, with upstream wasmtime 51 configured like the node's engine but without
its stack accounting. They show ratios, not absolute performance. The
transfers-per-second figures for the project come from the benchmark report,
not from here.

## What was measured

Microseconds per signature verification, median.

| Service build | wasm, fresh instance | wasm, reused instance | same source, native |
|---|---|---|---|
| Botan (the previous service), secp256k1 | 620 | 538 | 131 |
| Botan, P-256 | 511 | 459 | 128 |
| libsecp256k1, 32-bit limbs | 94 | 28 | 23 |
| libsecp256k1, 128-bit math as library calls | 200 | 120 | 12 |
| libsecp256k1, wide arithmetic, 1 MiB table | 81 | 14.4 | 12.2 |
| libsecp256k1, wide arithmetic, 8 KiB table (one page) | 28 | 15.6 | 13.2 |
| BearSSL P-256 (m64), wide arithmetic | 239 | 209 | 166 |

- `results/run1.txt`: Botan service, wasm against the same source as a shared library.
- `results/k1-run1.txt`, `results/k1-wide.txt`: libsecp256k1 across table sizes, with and without the wide-arithmetic instructions.
- `results/lean-run1.txt`: P-256 candidates (BearSSL m15/m31/m62/m64, p256-m).
- `results/restore.txt`: reusing an instance and restoring its memory from a post-init snapshot before each call (64 KiB restore costs about 0.5 us).

## Verifier check

`results/diff-final.txt`: 45,514 cases run through the new service and the
Botan service side by side.

- Cases: random valid signatures (both s values, compressed and uncompressed
  keys), wrong keys, single-bit corruptions of signature, hash and key, wrong
  lengths, boundary values of r and s, and the 514 Wycheproof ECDSA P1363
  vectors for secp256k1 and P-256.
- The new service gave the expected result in every case.
- It never accepted an input the Botan service rejected.
- The two differ only where intended: the new service rejects high-S
  signatures, and rejects 346 malformed encodings of valid keys that Botan
  accepted (a trailing byte, non-zero unused bits, a non-minimal curve
  identifier byte, hybrid-form points).

This is not yet an in-tree test. The in-tree coverage is
`packages/psibase_tests/test/test_verify_sig_keys.cpp`.

## Files

- `harness/`: Rust program that runs a verify-sig wasm under wasmtime and a
  native library through the same host interface; `--diff` compares two wasm
  services over a case file. `native_host.cpp` is the glue that lets the
  unmodified service source be linked as a shared library.
- `build_native.sh`: builds the Botan-based service source as a shared library.
- `k1/`, `lean/`: experimental service sources and the scripts that build each
  variant as wasm and as a shared library. The service that was merged is in
  `packages/system/VerifySig`, not here.
- `gen/gen.cpp`: writes packed `verifySys` actions for timing.
- `diff/gen_cases.cpp`, `diff/wycheproof_to_cases.py`: generate the cases for
  the verifier check.
