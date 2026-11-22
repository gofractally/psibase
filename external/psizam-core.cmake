# Native engine subset only. The high-level runtime/component facade depends on
# the new psio and must not enter the legacy-wire node's include or link image.
include("${CMAKE_CURRENT_LIST_DIR}/../cmake/PsibaseDependencies.cmake")
include("${CMAKE_CURRENT_LIST_DIR}/../cmake/ucc.cmake")
psibase_acquire_dependency(psizam)
psibase_add_ucc()
set(PSIBASE_PSIZAM_SOURCE_DIR "${psizam_SOURCE_DIR}")
if(NOT EXISTS "${PSIBASE_PSIZAM_SOURCE_DIR}/include/psizam/backend.hpp")
    message(FATAL_ERROR "The selected canonical psizam source has no native backend")
endif()
if(NOT CMAKE_SYSTEM_PROCESSOR MATCHES "^(x86_64|X86_64|amd64|AMD64|arm64|aarch64)$")
    message(FATAL_ERROR "The native psizam policy requires x86_64 or AArch64")
endif()
add_subdirectory("${PSIBASE_PSIZAM_SOURCE_DIR}/external" psizam-external)
add_library(psibase-psizam STATIC
    "${PSIBASE_PSIZAM_SOURCE_DIR}/src/runtime_helpers.cpp"
    "${PSIBASE_PSIZAM_SOURCE_DIR}/src/llvm_runtime_helpers.cpp"
    "${PSIBASE_PSIZAM_SOURCE_DIR}/src/call_on_stack.cpp"
    "${PSIBASE_PSIZAM_SOURCE_DIR}/src/eh_runtime.cpp"
    "${PSIBASE_PSIZAM_SOURCE_DIR}/src/debug/dwarf.cpp")
target_include_directories(psibase-psizam PUBLIC
    "${PSIBASE_PSIZAM_SOURCE_DIR}/include")
target_compile_definitions(psibase-psizam PUBLIC PSIZAM_SOFTFLOAT PSIZAM_DISABLE_EH)
target_compile_options(psibase-psizam PUBLIC
    $<$<COMPILE_LANG_AND_ID:CXX,Clang,AppleClang>:-fbracket-depth=1024>)
target_link_libraries(psibase-psizam PUBLIC softfloat ucc::ucc)

# JIT2 is the default until LLVM_AOT runs every module JIT2 does: today the AOT
# backend traps ("wasm memory out-of-bounds") in CpuLimit-schema-gen.wasm, which
# stops a from-scratch build while it generates service schemas. AOT is meant to
# be a cache in front of JIT2, not a replacement for it.
set(PSIBASE_VM_BACKEND "JIT2" CACHE STRING "Native VM: LLVM_AOT, JIT2, JIT1 or WASMTIME")
set_property(CACHE PSIBASE_VM_BACKEND PROPERTY STRINGS LLVM_AOT JIT2 JIT1 WASMTIME)
if(PSIBASE_VM_BACKEND STREQUAL "LLVM_AOT")
    find_package(LLVM REQUIRED CONFIG)
    if(CMAKE_SYSTEM_PROCESSOR MATCHES "^(x86_64|X86_64|amd64|AMD64)$")
        set(aot_arch x86)
        set(aot_definition PSIZAM_LLVM_TARGET_X86)
    else()
        set(aot_arch aarch64)
        set(aot_definition PSIZAM_LLVM_TARGET_AARCH64)
    endif()
    llvm_map_components_to_libnames(aot_libraries core support instcombine scalaropts object
        ${aot_arch}codegen ${aot_arch}asmparser ${aot_arch}desc ${aot_arch}info)
    target_sources(psibase-psizam PRIVATE
        "${PSIBASE_PSIZAM_SOURCE_DIR}/src/llvm_ir_translator.cpp"
        "${PSIBASE_PSIZAM_SOURCE_DIR}/src/llvm_aot_compiler.cpp")
    # LLVM distributions may place libc++abi's cxxabi.h beside LLVM headers.
    # Keep LLVM APIs available to the public AOT parser template without
    # shadowing the native standard library's ABI headers (libstdc++ on Linux).
    foreach(llvm_include IN LISTS LLVM_INCLUDE_DIRS)
        target_compile_options(psibase-psizam PUBLIC
            "$<$<COMPILE_LANGUAGE:CXX>:-idirafter${llvm_include}>")
    endforeach()
    target_compile_definitions(psibase-psizam PUBLIC PSIBASE_VM_LLVM_AOT
        PRIVATE ${aot_definition})
    if(NOT LLVM_ENABLE_RTTI)
        set_source_files_properties(
            "${PSIBASE_PSIZAM_SOURCE_DIR}/src/llvm_ir_translator.cpp"
            "${PSIBASE_PSIZAM_SOURCE_DIR}/src/llvm_aot_compiler.cpp"
            PROPERTIES COMPILE_OPTIONS -fno-rtti)
    endif()
    target_link_libraries(psibase-psizam PUBLIC ${aot_libraries})

    string(SHA256 native_toolchain_id
        "${LLVM_PACKAGE_VERSION};${LLVM_DEFINITIONS};${CMAKE_SYSTEM_PROCESSOR};${CMAKE_CXX_COMPILER_ID};${CMAKE_CXX_COMPILER_VERSION};${CMAKE_CXX_FLAGS};${CMAKE_CXX_FLAGS_RELEASE};${CMAKE_INTERPROCEDURAL_OPTIMIZATION}")
    # Bind the native host ABI and policy source too; explicit dirty source
    # overrides must not reuse old executable artifacts under an unchanged HEAD.
    set(host_identity "psibase-native-host-v1\n")
    foreach(tree libraries/psibase/native/include libraries/psibase/native/src
                 libraries/psibase/common/include libraries/psibase/common/src libraries/psio/include)
        file(GLOB_RECURSE host_identity_files CONFIGURE_DEPENDS LIST_DIRECTORIES false
            "${CMAKE_CURRENT_LIST_DIR}/../${tree}/*")
        list(SORT host_identity_files)
        foreach(file IN LISTS host_identity_files)
            set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS "${file}")
            file(RELATIVE_PATH relative "${CMAKE_CURRENT_LIST_DIR}/.." "${file}")
            file(SHA256 "${file}" digest)
            string(APPEND host_identity "${relative}:${digest}\n")
        endforeach()
    endforeach()
    file(SHA256 "${CMAKE_CURRENT_LIST_DIR}/../programs/psitest/main.cpp" tester_host_digest)
    set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS
        "${CMAKE_CURRENT_LIST_DIR}/../programs/psitest/main.cpp")
    file(SHA256 "${CMAKE_CURRENT_LIST_FILE}" host_build_digest)
    string(SHA256 host_identity
        "${host_identity}tester:${tester_host_digest}\nbuild:${host_build_digest}")
    file(CONFIGURE OUTPUT "${CMAKE_BINARY_DIR}/generated/psibase-native-aot-host.hpp"
        CONTENT "#pragma once\n#define PSIBASE_NATIVE_AOT_HOST_ID \"${host_identity}\"\n" @ONLY)
    target_include_directories(psibase-psizam PUBLIC "${CMAKE_BINARY_DIR}/generated")

    include(ExternalProject)
    set(codec_prefix "${CMAKE_BINARY_DIR}/psizam-artifact-codec")
    ExternalProject_Add(psibase-artifact-codec-build
        SOURCE_DIR "${CMAKE_CURRENT_LIST_DIR}/psizam-artifact-codec"
        BINARY_DIR "${codec_prefix}/build"
        CMAKE_ARGS
            "-DCMAKE_INSTALL_PREFIX=${codec_prefix}/install"
            "-DCMAKE_BUILD_TYPE=${CMAKE_BUILD_TYPE}"
            "-DCMAKE_C_COMPILER=${CMAKE_C_COMPILER}"
            "-DCMAKE_CXX_COMPILER=${CMAKE_CXX_COMPILER}"
            "-DCMAKE_CXX_FLAGS=${CMAKE_CXX_FLAGS}"
            "-DCMAKE_INTERPROCEDURAL_OPTIMIZATION=${CMAKE_INTERPROCEDURAL_OPTIMIZATION}"
            "-DPSIBASE_SOURCE_DIR=${CMAKE_CURRENT_LIST_DIR}/.."
            "-DPSIZAM_SOURCE_DIR=${PSIBASE_PSIZAM_SOURCE_DIR}"
            "-DPSIZAM_NATIVE_TOOLCHAIN_ID=${native_toolchain_id}"
            "-DFETCHCONTENT_SOURCE_DIR_PSIO=${FETCHCONTENT_SOURCE_DIR_PSIO}"
            "-DFETCHCONTENT_SOURCE_DIR_UCC=${ucc_SOURCE_DIR}"
        BUILD_ALWAYS TRUE
        BUILD_BYPRODUCTS "${codec_prefix}/install/lib/libpsizam-artifact-codec.a")
    add_library(psibase-artifact-codec STATIC IMPORTED GLOBAL)
    set_target_properties(psibase-artifact-codec PROPERTIES
        IMPORTED_LOCATION "${codec_prefix}/install/lib/libpsizam-artifact-codec.a")
    add_dependencies(psibase-artifact-codec psibase-artifact-codec-build)
    target_link_libraries(psibase-psizam PUBLIC psibase-artifact-codec)
elseif(PSIBASE_VM_BACKEND STREQUAL "JIT2")
    target_compile_definitions(psibase-psizam PUBLIC PSIBASE_VM_JIT2)
elseif(PSIBASE_VM_BACKEND STREQUAL "JIT1")
    target_compile_definitions(psibase-psizam PUBLIC PSIBASE_VM_JIT1)
elseif(PSIBASE_VM_BACKEND STREQUAL "WASMTIME")
    # The node executes services with wasmtime. psizam still validates every
    # module and supplies its stack costs, and the tester keeps a psizam engine.
    if(NOT EXISTS "${PSIBASE_PSIZAM_SOURCE_DIR}/wasmtime/CMakeLists.txt")
        message(FATAL_ERROR "The selected psizam source has no wasmtime backend")
    endif()
    add_subdirectory("${PSIBASE_PSIZAM_SOURCE_DIR}/wasmtime" psizam-wasmtime)
    target_link_libraries(psibase-psizam PUBLIC psizam-wasmtime)
    target_compile_definitions(psibase-psizam PUBLIC PSIBASE_VM_WASMTIME)
else()
    message(FATAL_ERROR "Unsupported PSIBASE_VM_BACKEND=${PSIBASE_VM_BACKEND}")
endif()
message(STATUS "psibase native VM: ${PSIBASE_VM_BACKEND}")
