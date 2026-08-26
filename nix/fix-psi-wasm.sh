#!/usr/bin/env bash
# Rewrite wasm so eos-vm accepts call_indirect (MVP 0x00 table byte).
# LLVM 21 / WASI SDK 29 emit a LEB table index; eos-vm requires a single 0x00.
# Encoding-only (no -O1): do not reoptimize compiled service code.
set -euo pipefail

root=${1:?usage: fix-psi-wasm.sh <dir>}
WASM_OPT_FLAGS=(
  --disable-reference-types
  --enable-bulk-memory
  --enable-sign-ext
  --enable-nontrapping-float-to-int
  --enable-simd
)

opt_wasm() {
  local f=$1
  wasm-opt "${WASM_OPT_FLAGS[@]}" "$f" -o "$f.opt.wasm"
  mv "$f.opt.wasm" "$f"
}

chmod -R u+w "$root"

while IFS= read -r -d '' f; do
  opt_wasm "$f"
done < <(find "$root" -name '*.wasm' -print0)

while IFS= read -r -d '' psi; do
  tmp=$(mktemp -d)
  unzip -q "$psi" -d "$tmp"
  chmod -R u+w "$tmp"
  changed=0
  if [ -d "$tmp/service" ]; then
    while IFS= read -r -d '' f; do
      opt_wasm "$f"
      changed=1
    done < <(find "$tmp/service" -name '*.wasm' -print0)
  fi
  if [ "$changed" = 1 ]; then
    rm -f "$psi"
    (cd "$tmp" && zip -r -X -q "$psi" .)
  fi
  rm -rf "$tmp"
done < <(find "$root" -name '*.psi' -print0)
