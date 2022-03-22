find_package(OpenSSL REQUIRED Crypto)

function(add suffix)
    add_library(psibase${suffix})
    target_link_libraries(psibase${suffix} PUBLIC abieos${suffix} psio boost OpenSSL::Crypto)
    target_sources(psibase${suffix} PRIVATE
        common/src/crypto.cpp
        common/src/trace.cpp
    )

    if(DEFINED IS_WASM)
        target_link_libraries(psibase${suffix} PUBLIC wasm-base${suffix})
        target_include_directories(psibase${suffix} PUBLIC common/include)

        add_library(psibase-contract-base${suffix})
        target_sources(psibase-contract-base${suffix} PRIVATE
            contract/src/eosio_polyfill.cpp
            contract/src/intrinsic.cpp
        )
        target_link_libraries(psibase-contract-base${suffix} PUBLIC psibase${suffix})
        target_compile_options(psibase-contract-base${suffix} PUBLIC -DCOMPILING_CONTRACT)
        target_link_options(psibase-contract-base${suffix} PUBLIC
            -Wl,--stack-first
            -Wl,--entry,start
            -Wl,--export=called
            -Wl,-z,stack-size=8192
            -Wl,--no-merge-data-segments
            -nostdlib
        )
        target_include_directories(psibase-contract-base${suffix} PUBLIC contract/include ../eosiolib/core/include ../eosiolib/contracts/include)

        file(GLOB LIBCLANG_RT_BUILTINS ${WASI_SDK_PREFIX}/lib/clang/*/lib/wasi/libclang_rt.builtins-wasm32.a)

        # Contract with simple malloc/free
        add_library(psibase-contract-simple-malloc${suffix} INTERFACE)
        target_link_libraries(psibase-contract-simple-malloc${suffix} INTERFACE
            -L${ROOT_BINARY_DIR}/wasm/libraries/eosiolib
            psibase-contract-base${suffix}
            -lc++
            -lc++abi-shrunk${suffix}
            c++abi-replacements${suffix}
            -lc-no-malloc${suffix}
            simple-malloc${suffix}
            eosio-contracts-wasi-polyfill${suffix}
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
            eosio-contracts-wasi-polyfill${suffix}
            ${LIBCLANG_RT_BUILTINS}
        )

        add_library(nctestlib${suffix})
        target_sources(nctestlib${suffix} PRIVATE
            tester/src/tester.cpp
            contract/src/intrinsic.cpp
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
            psibase${suffix}
            catch2
            boost
            -lsecp256k1
            -lc++
            -lc++abi
            -lc
            ${LIBCLANG_RT_BUILTINS}
            ${WASI_SDK_PREFIX}/share/wasi-sysroot/lib/wasm32-wasi/crt1.o
        )
        target_include_directories(nctestlib${suffix} PUBLIC
            contract/include
            ../eosiolib/core/include
            ../eosiolib/contracts/include
            tester/include
            ../../contracts/base_contracts/include
        )
        target_link_options(nctestlib${suffix} INTERFACE -Wl,--export-table)
        target_link_options(nctestlib${suffix} PUBLIC
            -Wl,--entry,_start
            -nostdlib
        )
    endif()

    if(DEFINED IS_NATIVE)
        find_package(Boost 1.67 REQUIRED COMPONENTS filesystem)

        target_link_libraries(psibase${suffix} PUBLIC eos-vm mdbx-static ${Boost_LIBRARIES})
        target_include_directories(psibase${suffix} PUBLIC
            native/include
            common/include
            ../../external/libmdbx)
        target_sources(psibase${suffix} PRIVATE
            native/src/block_context.cpp
            native/src/db.cpp
            native/src/execution_context.cpp
            native/src/system_context.cpp
            native/src/transaction_context.cpp
        )
    endif()
endfunction()

add("")
if(DEFINED IS_WASM)
    add("-debug")
endif()
