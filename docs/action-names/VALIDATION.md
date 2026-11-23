# Action-name validation and reviewer handoff

Validated 2026-11-23 on branch `codex/action-name-encoding`, based on `bytemaster/head` commit `44c57f739e20928daf9d020b79d2c9b1d9dd10a9`. This branch is for review and an explicit later merge; it does not deploy or retain old encoded IDs.

A non-mutating merge-tree check also passed against the subsequently advanced `bytemaster/head` tip `054a0c38665f5e378be2089dc7eabe005c95fc0d`. The feature branch does not merge or modify that target.

Current model: `774add87bf4a11e1c698d9c619c02bea398adb91f64a02ed746ad51e8e9bc7be`. The development model remains unlocked for final optimization.

## Results

- Independent C++, Rust and JavaScript ports agree on **6,704 full IDs and canonical name/hash-literal round trips**, plus **4,108 arbitrary/boundary IDs**, for **two distinct saved models**. The test restores the active model and verifies all three encoder source files are unchanged.
- C++ common tests: **102 assertions / 8 cases**; account goldens remain unchanged. Compile-time duplicate method names fail with the expected diagnostic. Native and actual WASI32 constexpr/dispatch/wrapper compilation pass. The SHA-256 length-padding test checks a fixed algorithm result independently of the trained model.
- Rust: **51 psibase**, **6 macro**, **5 names** unit tests, authorized trybuild and runnable doctests pass. The names crate and typed plugin code check on WASI32.
- Numeric Transact: **9 host tests** pass; the actual Transact component compiles for `wasm32-wasip1`. Typed callers transmit u64 IDs directly. Invalid raw IDs return errors before host calls.
- **28 actual C++↔Rust service-schema comparisons pass**. The C++ exporter produced 46 interface schemas. Fifteen package-schema tests have no C++ counterpart and require the normal freshly built SDK/package fixture setup; they are explicitly listed in the Rust report, not counted as passing comparisons.
- JS: TypeScript checking, package build, codec/browser sandbox tests and actual published ESM/CommonJS entry tests pass. Browser testing runs without Node/Buffer/crypto globals.
- Python node tests use the same frozen model; account, method and action/transaction packing checks pass. Model-specific bytes are generated or derived, so a retune does not require fixture source edits.
- Bounded training/reference tests: **35 pass**. Saved training weights reproduce the active model exactly; a modest next-step candidate that loses a protected descriptive name is rejected.
- Focused WASM dispatch object: **391,751 → 11,171 bytes**, and codec/model symbols **9 → 0**, after removing eager decoding/error-string construction from dispatch. These are same-fixture object sizes, not final application binary sizes.

Machine-readable evidence: [conformance](conformance.json), [two-model retuning](retuning.json), [Rust/schema/Transact commands and exclusions](rust-integration.json), [WASM dispatch footprint](cpp-dispatch-footprint.json).

## Reproduce the main checks

From the repository root:

```sh
corepack enable
```

Install the pinned JS workspace dependencies with `yarn install --immutable` from `packages/`, then run:

```sh
python3 tools/action_names.py check
python3 tools/action_names.py report
python3 tools/test_action_name_retuning.py
python3 -m unittest discover -s experiments/method-names -p 'test_action_name*.py'
python3 programs/psinode/tests/test_name.py
python3 programs/psinode/tests/test_psibase_types.py
cargo test --manifest-path rust/Cargo.toml -p psibase -p psibase_names -p psibase-macros-lib -p psibase-macros-derive -- --skip verify_schema
```

Boost headers are needed for reflection fixtures. The conformance tool detects Homebrew include paths; Linux CI installs `libboost-dev`. Package schema tests require `PSIBASE_DATADIR` from a normal rebuilt SDK, or `PSIBASE_SCHEMA_FIXTURE_DIR` for selected real C++ interface comparisons. The exporter script is `libraries/psibase/common/tests/export_action_name_schemas.py`; its `--include` option accepts Boost/RapidJSON include roots. Exact commands used locally are in the Rust evidence file.

Run `yarn build`, `yarn test:action-name`, and `yarn test:action-name-package` from `packages/user/CommonApi/common/packages/common-lib` to check browser/Node packaging. The dedicated Node/browser entry is `@psibase/common-lib/action-name`.

## Retune without changing callers

```sh
python3 tools/action_names.py report
python3 tools/action_names.py update request.json
python3 tools/action_names.py update request.json --apply
python3 tools/action_names.py check
python3 tools/test_action_name_retuning.py
```

An accepted update regenerates C++, Rust and TS data, full-ID goldens and their manifest. Rebuild all components against that model hash. See the [training/release checklist](../../doc/src/development/action-name-training.md). Shipping freezes the model; source aliases such as `MethodNumber` always use the one active codec.
