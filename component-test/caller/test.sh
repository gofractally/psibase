#!/bin/bash

cargo build -r --target wasm32-wasip2
cargo build -r --target wasm32-wasip2 --manifest-path ../callee/Cargo.toml
wac plug ./target/wasm32-wasip2/release/caller.wasm --plug ../callee/target/wasm32-wasip2/release/callee.wasm -o composed.wasm
wasmtime run --invoke 'hello()' composed.wasm