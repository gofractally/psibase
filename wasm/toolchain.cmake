cmake_minimum_required(VERSION 3.16.3)

set(CMAKE_SYSTEM_NAME WASI)
set(CMAKE_SYSTEM_VERSION 1)
set(CMAKE_SYSTEM_PROCESSOR wasm32)
set(triple wasm32-wasip1)
set(CMAKE_EXECUTABLE_SUFFIX_C .wasm)
set(CMAKE_EXECUTABLE_SUFFIX_CXX .wasm)

if(NOT ${WASM_CLANG_PREFIX} STREQUAL "" OR NOT ${WASM_CLANG_SUFFIX} STREQUAL "")
    set(CMAKE_C_COMPILER ${WASM_CLANG_PREFIX}clang${WASM_CLANG_SUFFIX})
    set(CMAKE_CXX_COMPILER ${WASM_CLANG_PREFIX}clang++${WASM_CLANG_SUFFIX})
    set(CMAKE_AR ${WASM_CLANG_PREFIX}llvm-ar${WASM_CLANG_SUFFIX})
    set(CMAKE_RANLIB ${WASM_CLANG_PREFIX}llvm-ranlib${WASM_CLANG_SUFFIX})
else()
    set(CMAKE_C_COMPILER ${WASI_SDK_PREFIX}/bin/clang)
    set(CMAKE_CXX_COMPILER ${WASI_SDK_PREFIX}/bin/clang++)
    set(CMAKE_AR ${WASI_SDK_PREFIX}/bin/llvm-ar)
    set(CMAKE_RANLIB ${WASI_SDK_PREFIX}/bin/llvm-ranlib)
endif()

set(CMAKE_C_COMPILER_TARGET ${triple})
set(CMAKE_CXX_COMPILER_TARGET ${triple})

set(CMAKE_C_COMPILER_WORKS 1)
set(CMAKE_CXX_COMPILER_WORKS 1)
set(CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER)
set(CMAKE_FIND_ROOT_PATH_MODE_LIBRARY ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_INCLUDE ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_PACKAGE ONLY)
