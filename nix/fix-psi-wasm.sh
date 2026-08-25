#!/usr/bin/env bash
# Rewrite service wasm so eos-vm accepts call_indirect (MVP 0x00 table byte).
# LLVM 21 / WASI SDK 29 emit a LEB table index; eos-vm requires a single 0x00.
set -euo pipefail

out=${1:?usage: fix-psi-wasm.sh <prefix>}
WASM_OPT_FLAGS=(
  -O1
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

if [ -d "$out/share/psibase/wasm" ]; then
  while IFS= read -r -d '' f; do
    opt_wasm "$f"
  done < <(find "$out/share/psibase/wasm" -name '*.wasm' -print0)
fi

if [ -d "$out/share/psibase/packages" ]; then
  shopt -s nullglob
  for psi in "$out/share/psibase/packages"/*.psi; do
    tmp=$(mktemp -d)
    unzip -q "$psi" -d "$tmp"
    chmod -R u+w "$tmp"
    if [ -d "$tmp/service" ]; then
      changed=0
      while IFS= read -r -d '' f; do
        opt_wasm "$f"
        changed=1
      done < <(find "$tmp/service" -name '*.wasm' -print0)
      if [ "$changed" = 1 ]; then
        rm -f "$psi"
        (cd "$tmp" && zip -r -X -q "$psi" .)
      fi
    fi
    rm -rf "$tmp"
  done
fi
