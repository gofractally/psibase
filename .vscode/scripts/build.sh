#!/usr/bin/env bash

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
PROJECT_ROOT="$(dirname "$(dirname "$SCRIPT_DIR")")"

export RUSTC_WRAPPER=sccache

mkdir -p "$PROJECT_ROOT/build"
cd "$PROJECT_ROOT/build"
cmake -DCMAKE_EXPORT_COMPILE_COMMANDS=ON \
      -DCMAKE_BUILD_TYPE=Release \
      -DBUILD_DEBUG_WASM=ON \
      -DCMAKE_CXX_COMPILER_LAUNCHER=ccache \
      -DCMAKE_C_COMPILER_LAUNCHER=ccache \
      -DCMAKE_INSTALL_PREFIX="psidk" \
      -DICU_LIBRARY_DIR="${ICU_LIBRARY_DIR:-${ICU_ROOT}/lib}" \
      -DCMAKE_PREFIX_PATH="${CMAKE_PREFIX_PATH}" \
      -DOPENSSL_ROOT_DIR="${OPENSSL_ROOT_DIR:-$(dirname "$(dirname "$(pkg-config --variable=includedir openssl 2>/dev/null)")")}" \
      -DCMAKE_IGNORE_PATH="${CMAKE_IGNORE_PATH:-/usr/lib:/usr/lib64}" \
      -DCMAKE_SYSTEM_IGNORE_PATH="${CMAKE_SYSTEM_IGNORE_PATH:-/usr/lib:/usr/lib64}" \
      "$PROJECT_ROOT"
cores_divisor="${1:-3}"
num_procs="$(nproc)"
jobs=$(( num_procs / cores_divisor ))
if [ "$jobs" -lt 1 ]; then jobs=1; fi
make install -j "$jobs"
