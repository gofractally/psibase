find_package(OpenSSL REQUIRED Crypto)

function(add suffix)
    add_library(psibase${suffix})
    target_link_libraries(psibase${suffix} PUBLIC abieos${suffix} psio boost OpenSSL::Crypto)
    target_sources(psibase${suffix} PRIVATE
        common/src/crypto.cpp
        common/src/time.cpp
        common/src/trace.cpp
    )

    if(DEFINED IS_WASM)
        target_link_libraries(psibase${suffix} PUBLIC wasm-base${suffix})
        target_include_directories(psibase${suffix} PUBLIC common/include)

        add_library(simple-malloc${suffix})
        target_link_libraries(simple-malloc${suffix} PUBLIC wasm-base${suffix})
        target_sources(simple-malloc${suffix} PRIVATE contract/src/simple_malloc.cpp)
        add_custom_command(
            TARGET simple-malloc${suffix}
            PRE_LINK
            COMMAND cp ${WASI_SDK_PREFIX}/share/wasi-sysroot/lib/wasm32-wasi/libc.a libc-no-malloc${suffix}.a
            COMMAND ${WASI_SDK_PREFIX}/bin/llvm-ar d libc-no-malloc${suffix}.a dlmalloc.o
        )

        add_library(c++abi-replacements${suffix})
        target_link_libraries(c++abi-replacements${suffix} PUBLIC wasm-base${suffix})
        target_sources(c++abi-replacements${suffix} PRIVATE contract/src/abort_message.cpp)
        add_custom_command(
            TARGET c++abi-replacements${suffix}
            PRE_LINK
            COMMAND cp ${WASI_SDK_PREFIX}/share/wasi-sysroot/lib/wasm32-wasi/libc++abi.a libc++abi-shrunk${suffix}.a
            COMMAND ${WASI_SDK_PREFIX}/bin/llvm-ar d libc++abi-shrunk${suffix}.a abort_message.cpp.o
        )

        add_library(psibase-contracts-wasi-polyfill${suffix})
        target_link_libraries(psibase-contracts-wasi-polyfill${suffix} PUBLIC wasm-base${suffix})
        target_sources(psibase-contracts-wasi-polyfill${suffix} PRIVATE
            contract/src/wasi-polyfill/__wasi_fd_fdstat_get.cpp
            contract/src/wasi-polyfill/__wasi_fd_close.cpp
            contract/src/wasi-polyfill/__wasi_fd_seek.cpp
            contract/src/wasi-polyfill/__wasi_fd_write.cpp
        )

        add_library(psibase-contract-base${suffix})
        target_sources(psibase-contract-base${suffix} PRIVATE
            contract/src/intrinsic.cpp
            contract/src/print.cpp
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
            -L${ROOT_BINARY_DIR}/wasm/libraries/psibase
            psibase-contract-base${suffix}
            -lc++
            -lc++abi-shrunk${suffix}
            c++abi-replacements${suffix}
            -lc-no-malloc${suffix}
            simple-malloc${suffix}
            psibase-contracts-wasi-polyfill${suffix}
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
            psibase-contracts-wasi-polyfill${suffix}
            ${LIBCLANG_RT_BUILTINS}
        )

        add_library(psitestlib${suffix})
        target_sources(psitestlib${suffix} PRIVATE
            tester/src/tester.cpp
            tester/src/DefaultTestChain.cpp
            contract/src/intrinsic.cpp
            tester/src/tester_intrinsics.cpp
            tester/src/wasi_polyfill/__wasi_args_get.cpp
            tester/src/wasi_polyfill/__wasi_args_sizes_get.cpp
            tester/src/wasi_polyfill/__wasi_clock_time_get.cpp
            tester/src/wasi_polyfill/__wasi_environ_get.cpp
            tester/src/wasi_polyfill/__wasi_environ_sizes_get.cpp
            tester/src/wasi_polyfill/__wasi_fd_close.cpp
            tester/src/wasi_polyfill/__wasi_fd_fdstat_get.cpp
            tester/src/wasi_polyfill/__wasi_fd_fdstat_set_flags.cpp
            tester/src/wasi_polyfill/__wasi_fd_prestat_dir_name.cpp
            tester/src/wasi_polyfill/__wasi_fd_prestat_get.cpp
            tester/src/wasi_polyfill/__wasi_fd_read.cpp
            tester/src/wasi_polyfill/__wasi_fd_seek.cpp
            tester/src/wasi_polyfill/__wasi_fd_write.cpp
            tester/src/wasi_polyfill/__wasi_path_open.cpp
            tester/src/wasi_polyfill/__wasi_proc_exit.cpp
        )
        target_compile_options(psitestlib${suffix} PUBLIC -DCOMPILING_TESTS)
        target_link_libraries(psitestlib${suffix} PUBLIC
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
        target_include_directories(psitestlib${suffix} PUBLIC
            contract/include
            ../eosiolib/core/include
            ../eosiolib/contracts/include
            tester/include
            ../../contracts/system/account_sys/include
            ../../contracts/system/auth_ec_sys/include
            ../../contracts/system/auth_fake_sys/include
            ../../contracts/system/rpc_account_sys/include
            ../../contracts/system/proxy_sys/include
            ../../contracts/system/transaction_sys/include
            ../../contracts/system/verify_ec_sys/include
        )
        target_include_directories(psitestlib${suffix} PRIVATE
            ../../contracts/system/verify_ec_sys/include
        )
        target_link_options(psitestlib${suffix} INTERFACE -Wl,--export-table)
        target_link_options(psitestlib${suffix} PUBLIC
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
