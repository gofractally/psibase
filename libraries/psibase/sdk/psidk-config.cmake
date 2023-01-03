cmake_minimum_required(VERSION 3.16.3)
project(psidk)

if(NOT (CMAKE_BUILD_TYPE STREQUAL "Mixed" OR CMAKE_BUILD_TYPE STREQUAL ""))
    # CMAKE_BUILD_TYPE doesn't work well when a single build mixes debug
    # and non-debug targets.
    message(FATAL_ERROR "CMAKE_BUILD_TYPE should be empty or set to \"Mixed\"")
endif()

get_filename_component(root ${CMAKE_CURRENT_LIST_DIR}/../../.. REALPATH)

add_library(wasm-base INTERFACE)
target_compile_options(wasm-base INTERFACE -fno-exceptions -DCOMPILING_WASM -mthread-model single -O3)
target_link_options(wasm-base INTERFACE -Wl,--strip-all -O3)

add_library(wasm-base-debug INTERFACE)
target_compile_options(wasm-base-debug INTERFACE -fno-exceptions -DCOMPILING_WASM -mthread-model single -ggdb)
target_link_options(wasm-base-debug INTERFACE -ggdb)

add_library(boost INTERFACE)
target_include_directories(boost INTERFACE ${root}/include)

add_library(catch2 INTERFACE)
target_include_directories(catch2 INTERFACE ${root}/include)
target_compile_options(catch2 INTERFACE -DCATCH_CONFIG_NO_POSIX_SIGNALS -DCATCH_CONFIG_DISABLE_EXCEPTIONS)

function(add_libs suffix)

    add_library(simdjson${suffix} INTERFACE)
    target_include_directories(simdjson${suffix} INTERFACE ${root}/include)
    target_link_libraries(simdjson${suffix} INTERFACE
        -L${root}/lib
        -lsimdjson # TODO: ${suffix}
    )

    add_library(psio${suffix} INTERFACE)
    target_include_directories(psio${suffix} INTERFACE ${root}/include)
    target_link_libraries(psio${suffix} INTERFACE
        boost
        simdjson${suffix}
        wasm-base${suffix}
    )

    add_library(psibase${suffix} INTERFACE)
    target_include_directories(psibase${suffix} INTERFACE ${root}/include)
    target_link_libraries(psibase${suffix} INTERFACE
        -L${root}/lib
        wasm-base${suffix}
        -lpsibase${suffix}
        psio${suffix}
        boost
    )

    add_library(psibase-service-base${suffix} INTERFACE)
    target_include_directories(psibase-service-base${suffix} INTERFACE ${root}/include)
    target_link_libraries(psibase-service-base${suffix} INTERFACE
        -L${root}/lib
        psibase${suffix}
        -lpsibase-service-base${suffix}
    )
    target_compile_options(psibase-service-base${suffix} INTERFACE -DCOMPILING_SERVICE)
    target_link_options(psibase-service-base${suffix} INTERFACE
        -Wl,--stack-first
        -Wl,--entry,start
        -Wl,--export=called
        -Wl,-z,stack-size=8192
        -Wl,--no-merge-data-segments
        -nostdlib
    )

    file(GLOB LIBCLANG_RT_BUILTINS ${WASI_SDK_PREFIX}/lib/clang/*/lib/wasi/libclang_rt.builtins-wasm32.a)

    # Service with simple malloc/free
    add_library(psibase-service-simple-malloc${suffix} INTERFACE)
    target_link_libraries(psibase-service-simple-malloc${suffix} INTERFACE
        -L${root}/lib
        psibase-service-base${suffix}
        -lc++
        -lc++abi-replacements${suffix}
        -lc-simple-malloc${suffix}
        -lpsibase-service-wasi-polyfill${suffix}
        ${LIBCLANG_RT_BUILTINS}
    )

    # Service with full malloc/free
    add_library(psibase-service${suffix} INTERFACE)
    target_link_libraries(psibase-service${suffix} INTERFACE
        -L${root}/lib
        psibase-service-base${suffix}
        -lc++
        -lc++abi-replacements${suffix}
        -lc
        -lpsibase-service-wasi-polyfill${suffix}
        ${LIBCLANG_RT_BUILTINS}
    )

    add_library(psitestlib${suffix} INTERFACE)
    target_compile_options(psitestlib${suffix} INTERFACE -DCOMPILING_TESTS)
    target_link_libraries(psitestlib${suffix} INTERFACE
        -L${root}/lib
        psibase${suffix}
        catch2
        boost
        -lc++
        -lc++abi
        -lc
        -lpsitestlib${suffix}
        ${LIBCLANG_RT_BUILTINS}
        ${WASI_SDK_PREFIX}/share/wasi-sysroot/lib/wasm32-wasi/crt1.o
    )
    target_link_options(psitestlib${suffix} INTERFACE
        -Wl,--entry,_start
        -nostdlib
    )
endfunction()

add_libs("")
add_libs("-debug")
