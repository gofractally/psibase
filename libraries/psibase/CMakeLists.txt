set(OPENSSL_USE_STATIC_LIBS TRUE)
find_package(OpenSSL REQUIRED Crypto)

function(add suffix)
    add_library(psibase${suffix})
    target_link_libraries(psibase${suffix} PUBLIC psio boost OpenSSL::Crypto)
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
        target_sources(simple-malloc${suffix} PRIVATE service/src/simple_malloc.cpp)
        add_custom_command(
            TARGET simple-malloc${suffix}
            PRE_LINK
            COMMAND cp ${WASI_SDK_PREFIX}/share/wasi-sysroot/lib/wasm32-wasi/libc.a libc-no-malloc${suffix}.a
            COMMAND ${WASI_SDK_PREFIX}/bin/llvm-ar d libc-no-malloc${suffix}.a dlmalloc.o
        )

        add_library(c++abi-replacements${suffix})
        target_link_libraries(c++abi-replacements${suffix} PUBLIC wasm-base${suffix})
        target_sources(c++abi-replacements${suffix} PRIVATE service/src/abort_message.cpp)
        add_custom_command(
            TARGET c++abi-replacements${suffix}
            PRE_LINK
            COMMAND cp ${WASI_SDK_PREFIX}/share/wasi-sysroot/lib/wasm32-wasi/libc++abi.a libc++abi-shrunk${suffix}.a
            COMMAND ${WASI_SDK_PREFIX}/bin/llvm-ar d libc++abi-shrunk${suffix}.a abort_message.cpp.o
        )

        add_library(psibase-service-wasi-polyfill${suffix})
        target_link_libraries(psibase-service-wasi-polyfill${suffix} PUBLIC wasm-base${suffix})
        target_sources(psibase-service-wasi-polyfill${suffix} PRIVATE
            service/src/wasi-polyfill/__wasi_fd_fdstat_get.cpp
            service/src/wasi-polyfill/__wasi_fd_close.cpp
            service/src/wasi-polyfill/__wasi_fd_seek.cpp
            service/src/wasi-polyfill/__wasi_fd_write.cpp
        )

        add_library(psibase-service-base${suffix})
        target_sources(psibase-service-base${suffix} PRIVATE
            service/src/intrinsic.cpp
            service/src/print.cpp
            service/src/Service.cpp
        )
        target_link_libraries(psibase-service-base${suffix} PUBLIC psibase${suffix})
        target_compile_options(psibase-service-base${suffix} PUBLIC -DCOMPILING_SERVICE)
        target_link_options(psibase-service-base${suffix} PUBLIC
            -Wl,--stack-first
            -Wl,--entry,start
            -Wl,--export=called
            -Wl,-z,stack-size=8192
            -Wl,--no-merge-data-segments
            -nostdlib
        )
        target_include_directories(psibase-service-base${suffix} PUBLIC service/include)

        file(GLOB LIBCLANG_RT_BUILTINS ${WASI_SDK_PREFIX}/lib/clang/*/lib/wasi/libclang_rt.builtins-wasm32.a)

        # Service with simple malloc/free
        add_library(psibase-service-simple-malloc${suffix} INTERFACE)
        target_link_libraries(psibase-service-simple-malloc${suffix} INTERFACE
            -L${ROOT_BINARY_DIR}/wasm/libraries/psibase
            psibase-service-base${suffix}
            -lc++
            -lc++abi-shrunk${suffix}
            c++abi-replacements${suffix}
            -lc-no-malloc${suffix}
            simple-malloc${suffix}
            psibase-service-wasi-polyfill${suffix}
            ${LIBCLANG_RT_BUILTINS}
        )

        # Service with full malloc/free
        add_library(psibase-service${suffix} INTERFACE)
        target_link_libraries(psibase-service${suffix} INTERFACE
            psibase-service-base${suffix}
            -lc++
            -lc++abi-shrunk${suffix}
            c++abi-replacements${suffix}
            -lc
            psibase-service-wasi-polyfill${suffix}
            ${LIBCLANG_RT_BUILTINS}
        )

        add_library(psitestlib${suffix})
        target_sources(psitestlib${suffix} PRIVATE
            tester/src/tester.cpp
            tester/src/DefaultTestChain.cpp
            tester/src/testUtils.cpp
            service/src/intrinsic.cpp
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
            service/include
            tester/include
            ../../services/system/AccountSys/include
            ../../services/system/ProducerSys/include
            ../../services/system/AuthEcSys/include
            ../../services/system/AuthAnySys/include
            ../../services/system/ProxySys/include
            ../../services/system/SetCodeSys/include
            ../../services/system/TransactionSys/include
            ../../services/system/VerifyEcSys/include
            ../../services/user/CommonSys/include
            ../../services/user/ExploreSys/include
            ../../services/user/InviteSys/include
            ../../services/user/NftSys/include
            ../../services/user/PsiSpaceSys/include
            ../../services/user/SymbolSys/include
            ../../services/user/TokenSys/include
        )
        target_include_directories(psitestlib${suffix} PRIVATE
            ../../services/system/VerifyEcSys/include
        )
        target_link_options(psitestlib${suffix} PUBLIC
            -Wl,--entry,_start
            -nostdlib
        )
    endif()

    if(DEFINED IS_NATIVE)
        find_package(Boost 1.67 REQUIRED COMPONENTS filesystem log_setup log)

        # FindBoost.cmake gets the library order wrong for Boost.Log
        target_link_libraries(psibase${suffix} PUBLIC eos-vm triedent secp256k1 -Wl,--start-group ${Boost_LIBRARIES} -Wl,--end-group)
        target_include_directories(psibase${suffix} PUBLIC
            native/include
            common/include)
        target_sources(psibase${suffix} PRIVATE
            native/src/BlockContext.cpp
            native/src/ConfigFile.cpp
            native/src/EcdsaProver.cpp
            native/src/ExecutionContext.cpp
            native/src/log.cpp
            native/src/NativeFunctions.cpp
            native/src/Prover.cpp
            native/src/SystemContext.cpp
            native/src/TransactionContext.cpp
            native/src/useTriedent.cpp
            native/src/VerifyProver.cpp
        )

        add_subdirectory(common/tests)
    endif()
endfunction()

add("")
if(DEFINED IS_WASM)
    add("-debug")
    add("-psidk")
    add("-debug-psidk")

    foreach(suffix "" "-debug")
        foreach(lib psibase psibase-service-base psibase-service-wasi-polyfill psitestlib)
            set_target_properties(${lib}${suffix}-psidk PROPERTIES ARCHIVE_OUTPUT_DIRECTORY ${ROOT_BINARY_DIR}/psidk/lib-wasm)
            set_target_properties(${lib}${suffix}-psidk PROPERTIES ARCHIVE_OUTPUT_NAME ${lib}${suffix})
        endforeach()
    endforeach()
endif()

if(IS_WASM)
    copy_headers(common/include/psibase psibase/common/include/psibase)
    copy_headers(service/include/psibase psibase/service/include/psibase)
    copy_headers(tester/include/psibase psibase/tester/include/psibase)
    configure_file(service/src/abort_message.cpp ${ROOT_BINARY_DIR}/psidk/service/src/abort_message.cpp COPYONLY)
    configure_file(service/src/simple_malloc.cpp ${ROOT_BINARY_DIR}/psidk/psibase/simple_malloc.cpp COPYONLY)
    configure_file(sdk/psidk-cmake-args ${ROOT_BINARY_DIR}/psidk/bin/psidk-cmake-args COPYONLY)
    configure_file(sdk/toolchain.cmake ${ROOT_BINARY_DIR}/psidk/toolchain.cmake COPYONLY)
    configure_file(sdk/psidk-config.cmake ${ROOT_BINARY_DIR}/psidk/psidk-config.cmake COPYONLY)
endif()
