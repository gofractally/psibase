cmake_minimum_required(VERSION 3.16)
project(psidk)

if(NOT (CMAKE_BUILD_TYPE STREQUAL "Mixed" OR CMAKE_BUILD_TYPE STREQUAL ""))
    # CMAKE_BUILD_TYPE doesn't work well when a single build mixes debug
    # and non-debug targets.
    message(FATAL_ERROR "CMAKE_BUILD_TYPE should be empty or set to \"Mixed\"")
endif()

add_library(wasm-base INTERFACE)
target_compile_options(wasm-base INTERFACE -fno-exceptions -DCOMPILING_WASM -mthread-model single -O3)
target_link_options(wasm-base INTERFACE -Wl,--strip-all -O3)

add_library(wasm-base-debug INTERFACE)
target_compile_options(wasm-base-debug INTERFACE -fno-exceptions -DCOMPILING_WASM -mthread-model single -ggdb)
target_link_options(wasm-base-debug INTERFACE -ggdb)

add_library(boost INTERFACE)
target_include_directories(boost INTERFACE ${psidk_DIR}/boost)

function(add_libs suffix)
    add_library(simdjson${suffix} INTERFACE)
    target_include_directories(simdjson${suffix} INTERFACE
        ${psidk_DIR}/simdjson/include
    )
    target_link_libraries(simdjson${suffix} INTERFACE
        -L${psidk_DIR}/lib-wasm
        -lsimdjson # TODO: ${suffix}
    )

    add_library(psio${suffix} INTERFACE)
    target_include_directories(psio${suffix} INTERFACE
        ${psidk_DIR}/consthash/include
        ${psidk_DIR}/psio/include
        ${psidk_DIR}/rapidjson/include
    )
    target_link_libraries(psio${suffix} INTERFACE
        boost
        simdjson${suffix}
        wasm-base${suffix}
    )

    add_library(simple-malloc${suffix} EXCLUDE_FROM_ALL)
    target_link_libraries(simple-malloc${suffix} PUBLIC wasm-base${suffix})
    target_sources(simple-malloc${suffix} PRIVATE ${psidk_DIR}/psibase/simple_malloc.cpp)
    add_custom_command(
        TARGET simple-malloc${suffix}
        PRE_LINK
        COMMAND cp ${WASI_SDK_PREFIX}/share/wasi-sysroot/lib/wasm32-wasi/libc.a libc-no-malloc${suffix}.a
        COMMAND ${WASI_SDK_PREFIX}/bin/llvm-ar d libc-no-malloc${suffix}.a dlmalloc.o
    )

    add_library(c++abi-replacements${suffix} EXCLUDE_FROM_ALL)
    target_link_libraries(c++abi-replacements${suffix} PUBLIC wasm-base${suffix})
    target_sources(c++abi-replacements${suffix} PRIVATE ${psidk_DIR}/contract/src/abort_message.cpp)
    add_custom_command(
        TARGET c++abi-replacements${suffix}
        PRE_LINK
        COMMAND cp ${WASI_SDK_PREFIX}/share/wasi-sysroot/lib/wasm32-wasi/libc++abi.a libc++abi-shrunk${suffix}.a
        COMMAND ${WASI_SDK_PREFIX}/bin/llvm-ar d libc++abi-shrunk${suffix}.a abort_message.cpp.o
    )

    add_library(psibase${suffix} INTERFACE)
    target_include_directories(psibase${suffix} INTERFACE ${psidk_DIR}/psibase/common/include)
    target_link_libraries(psibase${suffix} INTERFACE
        wasm-base${suffix}
        -lpsibase${suffix}
        psio${suffix}
        boost
    )

    add_library(psibase-contract-base${suffix} INTERFACE)
    target_link_libraries(psibase-contract-base${suffix} INTERFACE
        psibase${suffix}
        -lpsibase-contract-base${suffix}
    )
    target_compile_options(psibase-contract-base${suffix} INTERFACE -DCOMPILING_CONTRACT)
    target_link_options(psibase-contract-base${suffix} INTERFACE
        -Wl,--stack-first
        -Wl,--entry,start
        -Wl,--export=called
        -Wl,-z,stack-size=8192
        -Wl,--no-merge-data-segments
        -nostdlib
    )
    target_include_directories(psibase-contract-base${suffix} INTERFACE ${psidk_DIR}/psibase/contract/include)

    file(GLOB LIBCLANG_RT_BUILTINS ${WASI_SDK_PREFIX}/lib/clang/*/lib/wasi/libclang_rt.builtins-wasm32.a)

    # Contract with simple malloc/free
    add_library(psibase-contract-simple-malloc${suffix} INTERFACE)
    target_link_libraries(psibase-contract-simple-malloc${suffix} INTERFACE
        -L${CMAKE_CURRENT_BINARY_DIR}
        psibase-contract-base${suffix}
        -lc++
        -lc++abi-shrunk${suffix}
        c++abi-replacements${suffix}
        -lc-no-malloc${suffix}
        simple-malloc${suffix}
        -lpsibase-contracts-wasi-polyfill${suffix}
        ${LIBCLANG_RT_BUILTINS}
    )

    # Contract with full malloc/free
    add_library(psibase-contract${suffix} INTERFACE)
    target_link_libraries(psibase-contract${suffix} INTERFACE
        psibase-contract-base${suffix}
        -lc++
        -lc++abi-shrunk${suffix}
        c++abi-replacements${suffix}
        -lc
        -lpsibase-contracts-wasi-polyfill${suffix}
        ${LIBCLANG_RT_BUILTINS}
    )

    add_library(psitestlib${suffix} INTERFACE)
    target_compile_options(psitestlib${suffix} INTERFACE -DCOMPILING_TESTS)
    target_link_libraries(psitestlib${suffix} INTERFACE
        psibase${suffix}
        catch2
        boost
        -lc++
        -lc++abi
        -lc
        ${LIBCLANG_RT_BUILTINS}
        ${WASI_SDK_PREFIX}/share/wasi-sysroot/lib/wasm32-wasi/crt1.o
    )
    target_include_directories(psitestlib${suffix} INTERFACE
        ${psidk_DIR}/psibase/contract/include
        ${psidk_DIR}/psibase/tester/include
        ${psidk_DIR}/contracts/system/AccountSys/include
        ${psidk_DIR}/contracts/system/AuthEcSys/include
        ${psidk_DIR}/contracts/system/AuthFakeSys/include
        ${psidk_DIR}/contracts/system/ProxySys/include
        ${psidk_DIR}/contracts/system/RAccountSys/include
        ${psidk_DIR}/contracts/system/RAuthEcSys/include
        ${psidk_DIR}/contracts/system/SetCodeSys/include
        ${psidk_DIR}/contracts/system/TransactionSys/include
        ${psidk_DIR}/contracts/system/VerifyEcSys/include
    )
    target_link_options(psitestlib${suffix} INTERFACE
        -Wl,--entry,_start
        -nostdlib
    )
endfunction()

add_libs("")
add_libs("-debug")
