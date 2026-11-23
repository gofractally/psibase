# Rust API declaration extraction

This helper parses downloaded Rust source as syntax data using pinned `syn`
2.0.108. It never expands upstream macros, resolves imports, invokes upstream
build scripts, or compiles upstream crates. The helper's own Cargo dependencies
are separate parser dependencies, locked in `Cargo.lock`.

From the repository root, bootstrap dependencies once if they are not cached:

```sh
cargo build --locked --release --manifest-path experiments/method-names/rust-declaration-parser/Cargo.toml --target-dir build-method-names/rust-corpus-parser
python3 experiments/method-names/corpus_rust.py --self-test
python3 experiments/method-names/corpus_rust.py
```

The Python collector's parser build uses `--offline --locked`. Archives and build
artifacts stay under `build-method-names`. Subsequent collection uses immutable
source revisions from `expansion-rust-metadata.json`; `--refresh` explicitly
selects new revisions, except the intentionally historical standard-library
release remains 1.85.0.

The collector includes `pub` free functions, `pub` inherent methods, and methods
of `pub` traits. It excludes `pub(crate)` and `pub(super)`, trait-impl repetitions,
test/example/benchmark directories, `#[doc(hidden)]`, and cfg expressions which
require `cfg(test)`. It never traverses function bodies or macro token bodies.
Raw identifier syntax such as `r#type` records its actual identifier, `type`.

These are **public declaration candidates**, not a complete reachability-resolved
export list: public items in private modules may be re-exported, while public
methods on private types can also occur. Macro-generated methods are absent.
Compiler editions and unstable feature gates are not evaluated. Unsupported
syntax rejects a whole file, recorded with its path and line in the metadata.
All selected file hashes, archive hashes, revisions, and copied license hashes
are recorded there.

Standard library source is pinned to released Rust 1.85.0 because newer master
grammar drops many common APIs under this parser. This snapshot inspects 543
files, parses 541 successfully, and rejects `library/core/src/intrinsics/mod.rs`
and `library/core/src/ops/deref.rs` at unsupported `~const` trait bounds. Source
syntax and API spellings are never rewritten to make them parse. Ten other
projects parse without source-file errors in the recorded snapshot.
