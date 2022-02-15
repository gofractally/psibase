find_package(OpenSSL REQUIRED Crypto)

function(add suffix)
    add_library(newchain${suffix})
    target_link_libraries(newchain${suffix} PUBLIC abieos${suffix} boost OpenSSL::Crypto)
    target_include_directories(newchain${suffix} PUBLIC include/common)
    target_sources(newchain${suffix} PRIVATE
        src/common/crypto.cpp
    )

    if(DEFINED IS_WASM)
        target_link_libraries(newchain${suffix} PUBLIC wasm-base${suffix})

        add_library(newchain-contract-base${suffix} INTERFACE)
        target_link_libraries(newchain-contract-base${suffix} INTERFACE newchain${suffix})
        target_compile_options(newchain-contract-base${suffix} INTERFACE -DCOMPILING_CONTRACT)
        target_link_options(newchain-contract-base${suffix} INTERFACE
            -Wl,--stack-first
            -Wl,--entry,start
            -Wl,-z,stack-size=8192
            -Wl,--no-merge-data-segments
            -nostdlib
        )
        target_include_directories(newchain-contract-base${suffix} INTERFACE ../eosiolib/core/include ../eosiolib/contracts/include)

        # Contract with simple malloc/free
        add_library(newchain-contract-simple-malloc${suffix} INTERFACE)
        target_link_libraries(newchain-contract-simple-malloc${suffix} INTERFACE
            newchain-contract-base${suffix}
            -lc++
            -lc++abi-shrunk${suffix}
            c++abi-replacements${suffix}
            -lc-no-malloc${suffix}
            simple-malloc${suffix}
            eosio-contracts-wasi-polyfill${suffix}
            ${WASI_SDK_PREFIX}/lib/clang/11.0.0/lib/wasi/libclang_rt.builtins-wasm32.a
        )

        # Contract with full malloc/free
        add_library(newchain-contract${suffix} INTERFACE)
        target_link_libraries(newchain-contract${suffix} INTERFACE
            newchain-contract-base${suffix}
            -lc++
            -lc++abi-shrunk${suffix}
            c++abi-replacements${suffix}
            -lc
            eosio-contracts-wasi-polyfill${suffix}
            ${WASI_SDK_PREFIX}/lib/clang/11.0.0/lib/wasi/libclang_rt.builtins-wasm32.a
        )

        add_library(nctestlib${suffix})
        target_sources(nctestlib${suffix} PRIVATE
            src/tester/tester.cpp
            ../eosiolib/tester/tester_intrinsics.cpp
            ../eosiolib/tester/wasi_polyfill/__wasi_args_get.cpp
            ../eosiolib/tester/wasi_polyfill/__wasi_args_sizes_get.cpp
            ../eosiolib/tester/wasi_polyfill/__wasi_clock_time_get.cpp
            ../eosiolib/tester/wasi_polyfill/__wasi_environ_get.cpp
            ../eosiolib/tester/wasi_polyfill/__wasi_environ_sizes_get.cpp
            ../eosiolib/tester/wasi_polyfill/__wasi_fd_close.cpp
            ../eosiolib/tester/wasi_polyfill/__wasi_fd_fdstat_get.cpp
            ../eosiolib/tester/wasi_polyfill/__wasi_fd_fdstat_set_flags.cpp
            ../eosiolib/tester/wasi_polyfill/__wasi_fd_prestat_dir_name.cpp
            ../eosiolib/tester/wasi_polyfill/__wasi_fd_prestat_get.cpp
            ../eosiolib/tester/wasi_polyfill/__wasi_fd_read.cpp
            ../eosiolib/tester/wasi_polyfill/__wasi_fd_seek.cpp
            ../eosiolib/tester/wasi_polyfill/__wasi_fd_write.cpp
            ../eosiolib/tester/wasi_polyfill/__wasi_path_open.cpp
            ../eosiolib/tester/wasi_polyfill/__wasi_proc_exit.cpp
        )
        target_compile_options(nctestlib${suffix} PUBLIC -DCOMPILING_TESTS)
        target_link_libraries(nctestlib${suffix} PUBLIC
            newchain${suffix}
            catch2
            boost
            -lc++
            -lc++abi
            -lc
            ${WASI_SDK_PREFIX}/lib/clang/11.0.0/lib/wasi/libclang_rt.builtins-wasm32.a
            ${WASI_SDK_PREFIX}/share/wasi-sysroot/lib/wasm32-wasi/crt1.o
        )
        target_include_directories(nctestlib${suffix} PUBLIC ../eosiolib/core/include ../eosiolib/contracts/include include/tester)
        target_link_options(nctestlib${suffix} INTERFACE -Wl,--export-table)
        target_link_options(nctestlib${suffix} PUBLIC
            -Wl,--entry,_start
            -nostdlib
        )
    endif()

    if(DEFINED IS_NATIVE)
        target_link_libraries(newchain${suffix} PUBLIC chain)
        target_include_directories(newchain${suffix} PUBLIC include/native)
        target_sources(newchain${suffix} PRIVATE
            src/native/action_context.cpp
            src/native/block_context.cpp
            src/native/execution_context.cpp
            src/native/transaction_context.cpp
        )
    endif()
endfunction()

add("")
if(DEFINED IS_WASM)
    add("-debug")
endif()
