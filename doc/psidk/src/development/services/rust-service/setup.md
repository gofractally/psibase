# Rust Installation

## Installation

To get started with Rust service development, install the following:

- [Psidk C++ Support](../cpp-service/setup.md). We're using its `psibase`, `psinode`, and `psitest` executables. You may skip installing CMake, WASI SDK, and Binaryen unless you also plan to also do C++ development.
- Rust version 1.65.0 or later: see the commands below. If you don't have rustup installed, then follow the [rustup installation instructions](https://rustup.rs/).
- Rust's wasi support: see the commands below.
- `cargo-psibase`: see the commands below.

```
rustup update
rustup target add wasm32-wasip1
cargo install cargo-psibase
```

Do _not_ use `cargo install` to fetch `psibase`, `psinode`, or `psitest`; the executables in those packages are just placeholders. If you did, then run `cargo uninstall psibase psinode psitest` to fix.

You may have to periodically rerun `cargo install cargo-psibase` to keep up with ongoing development.
