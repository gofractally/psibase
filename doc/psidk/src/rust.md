# Rust Installation

## Not Yet Functional

This documents some of our current thoughts and ongoing development for Rust service support. The installation procedure and examples are currently non-functional.

## Installation

To get started with Rust service development, install the following:

- [Psidk C++ Support](linux.md). We're using its `psibase`, `psinode`, and `psitest` executables.
- Rust version 1.64.0 or later: see the commands below. If you don't have rustup installed, then follow the [rustup installation instructions](https://rustup.rs/).
- Rust's wasi support: see the commands below.
- `cargo-psibase`: see the commands below.

```
rustup update
rustup target add wasm32-wasi
cargo install cargo-psibase
```

Do _not_ use `cargo install` to fetch `psibase`, `psinode`, or `psitest`; the executables in those packages are just placeholders. If you did, then run `cargo uninstall psibase psinode psitest` to fix.

You may have to periodically rerun `cargo install cargo-psibase` to keep up with ongoing development.
