# Example contract in Rust

Requirements:

```sh
cargo install wasm-gc
```

To build:

```sh
cargo build --target wasm32-unknown-unknown --release

# to compress
wasm-gc target/wasm32-unknown-unknown/release/test_contract.wasm
```
