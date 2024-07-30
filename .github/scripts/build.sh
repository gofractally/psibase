#!/bin/bash
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
export SCCACHE_CACHE_SIZE=200M
export RUSTC_WRAPPER=sccache
DOCKER="docker run --rm \
  -v ${WORKSPACE_ROOT}:${WORKSPACE_ROOT} \
  -w ${WORKSPACE_ROOT} \
  -e CCACHE_DIR \
  -e CCACHE_CONFIGPATH \
  -e SCCACHE_DIR \
  -e SCCACHE_CACHE_SIZE \
  -e RUSTC_WRAPPER \
  -e WASM_PACK_CACHE=.wasm-pack-cache \
  --user $(id -u):$(id -g) \
  ${BUILDER_IMAGE}"

docker pull ${BUILDER_IMAGE}
echo =====
${DOCKER} ccache -s
echo =====
${DOCKER} sccache -s
echo =====
mkdir -p build
${DOCKER} bash -c "cd build && cmake -DCMAKE_BUILD_TYPE=Release -DBUILD_DEBUG_WASM=yes -DCMAKE_CXX_COMPILER_LAUNCHER=ccache -DCMAKE_C_COMPILER_LAUNCHER=ccache .."
echo =====
${DOCKER} bash -c "cd build && make -j $(nproc)"
echo =====
${DOCKER} bash -c "cd rust && cargo build"
echo =====
${DOCKER} bash -c "cd build && ctest --output-on-failure -j $(nproc)"
echo =====
ls -la ${WORKSPACE_ROOT}
ls -la ${WORKSPACE_ROOT}/build/doc/psidk
echo =====
${DOCKER} ccache -s
echo =====
${DOCKER} sccache -s
echo =====
${DOCKER} bash -c "cd build && cpack -G TGZ -D CPACK_PACKAGE_FILE_NAME=psidk-ubuntu-${UBUNTU_BUILD_VER}"
echo =====
${DOCKER} bash -c "cd build && mv book psidk-book && tar czf ../psidk-book.tar.gz psidk-book"
