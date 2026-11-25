#!/usr/bin/env bash
WORKSPACE_ROOT=$1
BUILDER_IMAGE=$2
UBUNTU_BUILD_VER=$3

set -e

if [ -z "$WORKSPACE_ROOT" ]; then
  echo "Error: WORKSPACE_ROOT is not set."
  exit 1
fi

if [ -z "$BUILDER_IMAGE" ]; then
  echo "Error: BUILDER_IMAGE is not set."
  exit 1
fi

if [ -z "$UBUNTU_BUILD_VER" ]; then
  echo "Error: UBUNTU_BUILD_VER is not set."
  exit 1
fi

cd ${WORKSPACE_ROOT}
git submodule update --init --recursive
export CCACHE_DIR=${WORKSPACE_ROOT}/.caches/ccache
export SCCACHE_DIR=${WORKSPACE_ROOT}/.caches/sccache
export CCACHE_CONFIGPATH=${WORKSPACE_ROOT}/ccache.conf
echo max_size = 600M >${WORKSPACE_ROOT}/ccache.conf
echo log_file = ${WORKSPACE_ROOT}/ccache.log >>${WORKSPACE_ROOT}/ccache.conf
export SCCACHE_IDLE_TIMEOUT=0
export SCCACHE_CACHE_SIZE=1G
export RUSTC_WRAPPER=sccache
if ! docker image inspect "${BUILDER_IMAGE}" >/dev/null 2>&1; then
  docker pull "${BUILDER_IMAGE}"
else
  echo "Using local image ${BUILDER_IMAGE}"
fi

# This branch compiles services with WebAssembly wide arithmetic and its
# native code needs a C++23 standard library. A builder image that carries the
# newer toolchain keeps it beside its defaults, under /opt, so that branches
# which do not need it build as before; select it here when it is present.
#   binaryen 133   wasm-opt that reads wide arithmetic
#   wasi-sdk 29    clang 21 and a matching sysroot for the services
#   Rust 1.100.0   128-bit arithmetic is correct with the wide-arithmetic feature
#   clang 20       host compiler, with a libstdc++ that has <format>
TOOLCHAIN=""
if docker run --rm "${BUILDER_IMAGE}" test -x /opt/wasi-sdk-29/bin/clang -a -x /opt/binaryen-133/bin/wasm-opt; then
  echo "Using the wide-arithmetic toolchain in ${BUILDER_IMAGE}"
  IMAGE_PATH=$(docker run --rm "${BUILDER_IMAGE}" printenv PATH)
  TOOLCHAIN="-e WASI_SDK_PREFIX=/opt/wasi-sdk-29 \
  -e RUSTUP_TOOLCHAIN=1.100.0 \
  -e CC=clang-20 \
  -e CXX=clang++-20 \
  -e PATH=/opt/binaryen-133/bin:/opt/wasi-sdk-29/bin:${IMAGE_PATH}"
fi

# npm (used by one UI package) keeps its cache in the home directory, which the
# container's user does not have. Keep it with the other caches.
export npm_config_cache=${WORKSPACE_ROOT}/.caches/npm

# (Note for cargo-generate to be happy) Ensure there's a $USER environment variable set with username corresponding to the uid of the user running the container
DOCKER="docker run --rm \
  -v ${WORKSPACE_ROOT}:${WORKSPACE_ROOT} \
  -w ${WORKSPACE_ROOT} \
  -e CCACHE_DIR \
  -e CCACHE_CONFIGPATH \
  -e SCCACHE_DIR \
  -e SCCACHE_IDLE_TIMEOUT \
  -e SCCACHE_CACHE_SIZE \
  -e RUSTC_WRAPPER \
  -e WASM_PACK_CACHE=${WORKSPACE_ROOT}/.caches/wasm-pack \
  -e CARGO_COMPONENT_CACHE_DIR=${WORKSPACE_ROOT}/.caches/cargo-component \
  -e USER \
  -e npm_config_cache \
  ${TOOLCHAIN} \
  --user $(id -u):$(id -g) \
  ${BUILDER_IMAGE}"

echo "===== ccache  ====="
${DOCKER} ccache -s
echo "===== sccache ====="
${DOCKER} sccache -s
echo "===== build start ====="
mkdir -p build
${DOCKER} bash -c "cd build && cmake -DCMAKE_BUILD_TYPE=Release -DBUILD_DEBUG_WASM=no -DCMAKE_CXX_COMPILER_LAUNCHER=ccache -DCMAKE_C_COMPILER_LAUNCHER=ccache .."
${DOCKER} bash -c "cd build && make -j $(nproc) && ( echo '===== sccache ====='; sccache -s; echo '===== ccache ====='; ccache -s )"
echo =====
${DOCKER} bash -c "cd rust && cargo build --target-dir ../build/rust --release"
echo =====
${DOCKER} bash -c "cd build && ctest --output-on-failure -j $(nproc) --timeout 600"
echo =====
ls -la ${WORKSPACE_ROOT}
ls -la ${WORKSPACE_ROOT}/build/doc
echo =====
${DOCKER} bash -c "cd build && cpack -G TGZ -D CPACK_PACKAGE_FILE_NAME=psidk-ubuntu-${UBUNTU_BUILD_VER}"
echo =====
${DOCKER} bash -c "cd build && mv book psidk-book && tar czf ../psidk-book.tar.gz psidk-book"
echo =====
if [[ -n "$(git status --porcelain --untracked-files=all)" ]]; then
  echo "Build left the working tree dirty:"
  git status --short --untracked-files=all
  exit 1
fi
${DOCKER} bash -c "cargo generate -p ./package-templates/ --destination ./packages/user/ --init -v --allow-commands --name Buildtest --silent basic-01 ; cd packages/user/Buildtest && ${WORKSPACE_ROOT}/build/rust/release/cargo-psibase package"
