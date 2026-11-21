#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../../.."
: "${CARGO_PSIBASE:=cargo-psibase}"
: "${CARGO_TARGET_DIR:=$PWD/target}"
: "${PSIBASE_DATADIR:?Set PSIBASE_DATADIR to the matching SDK data directory (containing packages)}"
mkdir -p "$CARGO_TARGET_DIR"
CARGO_TARGET_DIR="$(cd "$CARGO_TARGET_DIR" && pwd)"
export CARGO_TARGET_DIR
export FAVOR_TEST_SERVICE="$CARGO_TARGET_DIR/wasm32-wasip1/release/favor.wasm"
export FAVOR_TEST_QUERY_SERVICE="$CARGO_TARGET_DIR/wasm32-wasip1/release/r-favor.wasm"
python3 -m unittest discover -s packages/user/Favor/test -p test_rejections.py
"$CARGO_PSIBASE" psibase --manifest-path packages/user/Cargo.toml -p favor -p r-favor build
"$CARGO_PSIBASE" psibase --manifest-path packages/user/Cargo.toml -p favor test "$@"
