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

# wasmtime is the default engine: it compiles a service in tens of
# milliseconds where LLVM takes seconds, and runs it far faster than JIT1 or
# JIT2. LLVM_AOT, JIT2 and JIT1 remain selectable single-engine builds.
set(PSIBASE_VM_BACKEND "WASMTIME" CACHE STRING
    "Native VM: WASMTIME, LLVM_AOT, JIT2, JIT1, or DYNAMIC to build several and choose at run time")
set_property(CACHE PSIBASE_VM_BACKEND PROPERTY STRINGS WASMTIME LLVM_AOT JIT2 JIT1 DYNAMIC)
set(PSIBASE_VM_ENGINES "WASMTIME;JIT2" CACHE STRING
    "With PSIBASE_VM_BACKEND=DYNAMIC: the engines to build (WASMTIME, JIT2, JIT1). The first is the default; PSIBASE_VM_ENGINE or psinode --vm-engine selects another")

# Each engine is a namespace exporting engine() (see VmEngine.hpp) and the
# source that defines it. VmEngine.cpp reads the generated list.
set(vm_engine_namespaces)
set(vm_engine_sources)
function(psibase_add_wasmtime_engine)
    # The node executes services with wasmtime. psizam still validates every
    # module and supplies its stack costs.
    if(NOT EXISTS "${PSIBASE_PSIZAM_SOURCE_DIR}/wasmtime/CMakeLists.txt")
        message(FATAL_ERROR "The selected psizam source has no wasmtime backend")
    endif()
    add_subdirectory("${PSIBASE_PSIZAM_SOURCE_DIR}/wasmtime" psizam-wasmtime)
    target_link_libraries(psibase-psizam PUBLIC psizam-wasmtime)
endfunction()
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
    # The codec's symbol table names the runtime helpers and softfloat routines
    # that psibase-psizam provides, and psibase-psizam calls the codec. Linkers
    # that resolve archives in order (GNU ld) need the cycle stated, so that
    # the providers are listed again after the codec.
    set_target_properties(psibase-artifact-codec PROPERTIES
        INTERFACE_LINK_LIBRARIES "psibase-psizam;softfloat")
    target_link_libraries(psibase-psizam PUBLIC psibase-artifact-codec)
    set(vm_engine_namespaces vm_llvm_aot)
    set(vm_engine_sources native/src/ExecutionContext.cpp)
elseif(PSIBASE_VM_BACKEND STREQUAL "JIT2")
    target_compile_definitions(psibase-psizam PUBLIC PSIBASE_VM_JIT2)
    set(vm_engine_namespaces vm_jit2)
    set(vm_engine_sources native/src/ExecutionContext.cpp)
elseif(PSIBASE_VM_BACKEND STREQUAL "JIT1")
    target_compile_definitions(psibase-psizam PUBLIC PSIBASE_VM_JIT1)
    set(vm_engine_namespaces vm_jit1)
    set(vm_engine_sources native/src/ExecutionContext.cpp)
elseif(PSIBASE_VM_BACKEND STREQUAL "WASMTIME")
    psibase_add_wasmtime_engine()
    # The tester and the psizam-specific tests keep a psizam engine (JIT2).
    target_compile_definitions(psibase-psizam PUBLIC PSIBASE_VM_WASMTIME)
    set(vm_engine_namespaces vm_wasmtime)
    set(vm_engine_sources native/src/ExecutionContextWasmtime.cpp)
elseif(PSIBASE_VM_BACKEND STREQUAL "DYNAMIC")
    if(NOT PSIBASE_VM_ENGINES)
        message(FATAL_ERROR "PSIBASE_VM_BACKEND=DYNAMIC needs at least one engine in PSIBASE_VM_ENGINES")
    endif()
    target_compile_definitions(psibase-psizam PUBLIC PSIBASE_VM_DYNAMIC)
    foreach(engine IN LISTS PSIBASE_VM_ENGINES)
        if(engine STREQUAL "WASMTIME")
            psibase_add_wasmtime_engine()
            list(APPEND vm_engine_namespaces vm_wasmtime)
            list(APPEND vm_engine_sources native/src/ExecutionContextWasmtime.cpp)
        elseif(engine STREQUAL "JIT2")
            list(APPEND vm_engine_namespaces vm_jit2)
            list(APPEND vm_engine_sources native/src/ExecutionContextJit2.cpp)
        elseif(engine STREQUAL "JIT1")
            list(APPEND vm_engine_namespaces vm_jit1)
            list(APPEND vm_engine_sources native/src/ExecutionContextJit1.cpp)
        elseif(engine STREQUAL "LLVM_AOT")
            # Its compile settings and artifact identity apply to the whole
            # build today (see the LLVM_AOT branch above).
            message(FATAL_ERROR "LLVM_AOT cannot yet be one of several engines; build it with PSIBASE_VM_BACKEND=LLVM_AOT")
        else()
            message(FATAL_ERROR "Unknown engine in PSIBASE_VM_ENGINES: ${engine}")
        endif()
    endforeach()
    list(LENGTH vm_engine_namespaces engine_count)
    list(REMOVE_DUPLICATES vm_engine_namespaces)
    list(LENGTH vm_engine_namespaces unique_count)
    if(NOT engine_count EQUAL unique_count)
        message(FATAL_ERROR "PSIBASE_VM_ENGINES names an engine twice: ${PSIBASE_VM_ENGINES}")
    endif()
else()
    message(FATAL_ERROR "Unsupported PSIBASE_VM_BACKEND=${PSIBASE_VM_BACKEND}")
endif()
set(vm_engine_list "")
foreach(namespace IN LISTS vm_engine_namespaces)
    string(APPEND vm_engine_list "PSIBASE_VM_ENGINE(${namespace})\n")
endforeach()
file(CONFIGURE OUTPUT "${CMAKE_BINARY_DIR}/generated/psibase-vm-engines.inc"
    CONTENT "${vm_engine_list}" @ONLY)
target_include_directories(psibase-psizam PUBLIC "${CMAKE_BINARY_DIR}/generated")
set_property(GLOBAL PROPERTY PSIBASE_VM_ENGINE_SOURCES "${vm_engine_sources}")
message(STATUS "psibase native VM: ${PSIBASE_VM_BACKEND} (${vm_engine_namespaces})")
