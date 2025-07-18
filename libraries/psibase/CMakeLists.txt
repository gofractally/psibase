if(BUILD_STATIC)
    set(OPENSSL_USE_STATIC_LIBS TRUE)
endif()
find_package(OpenSSL REQUIRED Crypto)

function(add suffix)
    add_library(psibase${suffix})
    target_link_libraries(psibase${suffix} PUBLIC psio boost OpenSSL::Crypto)
    target_sources(psibase${suffix} PRIVATE
        common/src/block.cpp
        common/src/crypto.cpp
        common/src/KvMerkle.cpp
        common/src/nativeTables.cpp
        common/src/Rpc.cpp
        common/src/schema.cpp
        common/src/trace.cpp
        common/src/jwt.cpp
        common/src/serviceEntry.cpp
    )

    if(DEFINED IS_WASM)
        find_package(Catch2 3 REQUIRED)
        target_link_libraries(psibase${suffix} PUBLIC wasm-base${suffix})
        target_mapped_include_directories(psibase${suffix} PUBLIC common/include wasm32-psibase)

        add_library(simple-malloc-objects${suffix} OBJECT service/src/simple_malloc.cpp)
        target_link_libraries(simple-malloc-objects${suffix} PUBLIC wasm-base${suffix})
        add_custom_target(c-simple-malloc${suffix} ALL DEPENDS libc-simple-malloc${suffix}.a)
        add_custom_command(
            OUTPUT libc-simple-malloc${suffix}.a
            DEPENDS simple-malloc-objects${suffix}
            COMMAND cp ${WASI_SDK_PREFIX}/share/wasi-sysroot/lib/wasm32-wasip1/libc.a libc-simple-malloc${suffix}.a
            COMMAND ${WASI_SDK_PREFIX}/bin/llvm-ar d libc-simple-malloc${suffix}.a dlmalloc.o
            COMMAND ${WASI_SDK_PREFIX}/bin/llvm-ar rs libc-simple-malloc${suffix}.a $<TARGET_OBJECTS:simple-malloc-objects${suffix}>
            COMMAND_EXPAND_LISTS
        )

        add_library(c++abi-objects${suffix} OBJECT service/src/abort_message.cpp)
        target_link_libraries(c++abi-objects${suffix} PUBLIC wasm-base${suffix})
        add_custom_target(c++abi-replacements${suffix} ALL DEPENDS libc++abi-replacements${suffix}.a)
        add_custom_command(
            OUTPUT libc++abi-replacements${suffix}.a
            DEPENDS c++abi-objects${suffix}
            COMMAND cp ${WASI_SDK_PREFIX}/share/wasi-sysroot/lib/wasm32-wasip1/libc++abi.a libc++abi-replacements${suffix}.a
            COMMAND ${WASI_SDK_PREFIX}/bin/llvm-ar rs libc++abi-replacements${suffix}.a $<TARGET_OBJECTS:c++abi-objects${suffix}>
        )

        add_library(psibase-service-wasi-polyfill${suffix})
        target_link_libraries(psibase-service-wasi-polyfill${suffix} PUBLIC wasm-base${suffix})
        target_sources(psibase-service-wasi-polyfill${suffix} PRIVATE
            service/src/ossl.c
            service/src/time.c
            service/src/wasi-polyfill/__wasi_clock_time_get.cpp
            service/src/wasi-polyfill/__wasi_environ_get.cpp
            service/src/wasi-polyfill/__wasi_environ_sizes_get.cpp
            service/src/wasi-polyfill/__wasi_fd_fdstat_get.cpp
            service/src/wasi-polyfill/__wasi_fd_fdstat_set_flags.cpp
            service/src/wasi-polyfill/__wasi_fd_filestat_get.cpp
            service/src/wasi-polyfill/__wasi_fd_prestat_get.cpp
            service/src/wasi-polyfill/__wasi_fd_prestat_dir_name.cpp
            service/src/wasi-polyfill/__wasi_fd_close.cpp
            service/src/wasi-polyfill/__wasi_fd_read.cpp
            service/src/wasi-polyfill/__wasi_fd_readdir.cpp
            service/src/wasi-polyfill/__wasi_fd_seek.cpp
            service/src/wasi-polyfill/__wasi_fd_write.cpp
            service/src/wasi-polyfill/__wasi_path_filestat_get.cpp
            service/src/wasi-polyfill/__wasi_path_open.cpp
            service/src/wasi-polyfill/__wasi_proc_exit.cpp
        )

        add_library(psibase-service-base${suffix})
        target_sources(psibase-service-base${suffix} PRIVATE
            service/src/intrinsic.cpp
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
        target_mapped_include_directories(psibase-service-base${suffix} PUBLIC service/include)

        file(GLOB LIBCLANG_RT_BUILTINS ${WASI_SDK_PREFIX}/lib/clang/*/lib/wasi/libclang_rt.builtins-wasm32.a)

        # Service with simple malloc/free
        add_library(psibase-service-simple-malloc${suffix} INTERFACE)
        target_link_libraries(psibase-service-simple-malloc${suffix} INTERFACE
            -L${ROOT_BINARY_DIR}/wasm/libraries/psibase
            psibase-service-base${suffix}
            -lc++
            c++abi-replacements${suffix}
            c-simple-malloc${suffix}
            psibase-service-wasi-polyfill${suffix}
            ${LIBCLANG_RT_BUILTINS}
        )

        # Service with full malloc/free
        add_library(psibase-service${suffix} INTERFACE)
        target_link_libraries(psibase-service${suffix} INTERFACE
            -L${ROOT_BINARY_DIR}/wasm/libraries/psibase
            psibase-service-base${suffix}
            -lc++
            c++abi-replacements${suffix}
            -lc
            psibase-service-wasi-polyfill${suffix}
            ${LIBCLANG_RT_BUILTINS}
        )

        add_library(exception-stub${suffix})
        target_sources(exception-stub${suffix} PRIVATE service/src/exceptions.cpp)
        target_include_directories(exception-stub${suffix} PRIVATE common/include)
        target_compile_options(exception-stub${suffix} INTERFACE -fexceptions)
        target_link_libraries(exception-stub${suffix} PUBLIC wasm-base${suffix})

        add_library(psitestlib${suffix})
        target_sources(psitestlib${suffix} PRIVATE
            tester/src/tester.cpp
            tester/src/DefaultTestChain.cpp
            tester/src/package.cpp
            tester/src/semver.cpp
            tester/src/zip.cpp
            tester/src/testUtils.cpp
            service/src/intrinsic.cpp
            service/src/ossl.c
            service/src/time.c
            tester/src/chain_polyfill.cpp
            tester/src/wasi_polyfill/system.cpp
            tester/src/wasi_polyfill/init_cwd.cpp
        )
        target_compile_options(psitestlib${suffix} PUBLIC -DCOMPILING_TESTS)
        target_link_libraries(psitestlib${suffix} PUBLIC
            psibase${suffix}
            Spki${suffix}
            PrivateKeyInfo${suffix}
            Catch2::Catch2
            boost
            -lz
            -lc++
            -lc++abi
            -L${CMAKE_CURRENT_BINARY_DIR}
            -lc
            ${LIBCLANG_RT_BUILTINS}
            ${WASI_SDK_PREFIX}/share/wasi-sysroot/lib/wasm32-wasip1/crt1.o
        )
        target_mapped_include_directories(psitestlib${suffix} PUBLIC
            service/include
            tester/include
            ../../services/system/Accounts/include
            ../../services/system/Producers/include
            ../../services/system/AuthDelegate/include
            ../../services/system/AuthSig/include
            ../../services/system/AuthAny/include
            ../../services/system/CpuLimit/include
            ../../services/system/HttpServer/include
            ../../services/system/SetCode/include
            ../../services/system/StagedTx/service/cpp/include
            ../../services/system/Transact/include
            ../../services/user/CommonApi/include
            ../../services/user/Explorer/include
            ../../services/user/Invite/include
            ../../services/user/Nft/include
            ../../services/user/Packages/include
            ../../services/user/Sites/include
            ../../services/user/Symbol/include
            ../../services/user/Tokens/include
        )
        target_mapped_include_directories(psitestlib${suffix} PRIVATE
            ../../services/system/VerifySig/include
        )
        target_link_options(psitestlib${suffix} PUBLIC
            -Wl,--entry,_start
            -nostdlib
        )
    endif()

    if(DEFINED IS_NATIVE)
        find_package(Boost 1.70 CONFIG REQUIRED COMPONENTS filesystem log)

        target_link_libraries(psibase${suffix} PUBLIC eos-vm triedent Boost::filesystem Boost::log debug_eos_vm -ldl)
        target_include_directories(psibase${suffix} PUBLIC
            native/include
            common/include)
        target_sources(psibase${suffix} PRIVATE
            native/src/BlockContext.cpp
            native/src/ConfigFile.cpp
            native/src/ExecutionContext.cpp
            native/src/ForkDb.cpp
            native/src/log.cpp
            native/src/NativeFunctions.cpp
            native/src/OpenSSLProver.cpp
            native/src/pkcs11.cpp
            native/src/PKCS11Prover.cpp
            native/src/prefix.cpp
            native/src/Prover.cpp
            native/src/RunQueue.cpp
            native/src/Socket.cpp
            native/src/SystemContext.cpp
            native/src/TransactionContext.cpp
            native/src/useTriedent.cpp
            native/src/VerifyProver.cpp
            native/src/Watchdog.cpp
        )

        add_subdirectory(native/tests)
        add_subdirectory(common/tests)
    endif()
endfunction()

add("")
if(DEFINED IS_WASM)
    add("-debug")
endif()

if(IS_WASM)
    install(DIRECTORY common/include/psibase TYPE INCLUDE COMPONENT libpsibase FILES_MATCHING PATTERN "*.hpp")
    install(DIRECTORY tester/include/psibase TYPE INCLUDE COMPONENT libpsibase FILES_MATCHING PATTERN "*.hpp")
    install(DIRECTORY wasm32-psibase TYPE INCLUDE COMPONENT libpsibase FILES_MATCHING PATTERN "*.h")
    install(PROGRAMS sdk/psidk-cmake-args TYPE BIN COMPONENT libpsibase)
    install(FILES sdk/psibase-config.cmake DESTINATION ${CMAKE_INSTALL_LIBDIR}/cmake/psibase COMPONENT libpsibase)
    install(FILES ${CMAKE_CURRENT_BINARY_DIR}/libc++abi-replacements.a ${CMAKE_CURRENT_BINARY_DIR}/libc++abi-replacements-debug.a TYPE LIB COMPONENT libpsibase)
    install(FILES ${CMAKE_CURRENT_BINARY_DIR}/libc-simple-malloc.a ${CMAKE_CURRENT_BINARY_DIR}/libc-simple-malloc-debug.a TYPE LIB COMPONENT libpsibase)
    install(TARGETS psibase psibase-service-base psibase-service-wasi-polyfill psitestlib
        psibase-debug psibase-service-base-debug psibase-service-wasi-polyfill-debug psitestlib-debug
        ARCHIVE COMPONENT libpsibase)
    install(FILES sdk/toolchain.cmake DESTINATION ${CMAKE_INSTALL_DATADIR}/psibase/cmake COMPONENT libpsibase)
    install(FILES sdk/WASI.cmake DESTINATION ${CMAKE_INSTALL_DATADIR}/wasi-sysroot/share/cmake/Modules/Platform COMPONENT libpsibase)
    install(PROGRAMS sdk/psibase-wasm-opt DESTINATION ${CMAKE_INSTALL_DATADIR}/psibase/cmake COMPONENT libpsibase)
    install(PROGRAMS sdk/nop-wasm-opt DESTINATION ${CMAKE_INSTALL_DATADIR}/psibase/cmake COMPONENT libpsibase)
    install(FILES sdk/pack_service.cmake sdk/generate_service_info.cmake DESTINATION ${CMAKE_INSTALL_LIBDIR}/cmake/psibase COMPONENT libpsibase)

    configure_file(sdk/psibase-config.cmake.build ${ROOT_BINARY_DIR}/psibase-config.cmake @ONLY)
    configure_file(sdk/psidk-cmake-args.build ${ROOT_BINARY_DIR}/psidk-cmake-args @ONLY)
    configure_file(sdk/toolchain.cmake ${ROOT_BINARY_DIR}/toolchain.cmake COPYONLY)
    configure_file(sdk/WASI.cmake ${ROOT_BINARY_DIR}/cmake/Platform/WASI.cmake COPYONLY)
    configure_file(sdk/psibase-wasm-opt ${ROOT_BINARY_DIR}/psibase-wasm-opt COPYONLY)
    configure_file(sdk/nop-wasm-opt ${ROOT_BINARY_DIR}/nop-wasm-opt COPYONLY)
    configure_file(sdk/pack_service.cmake ${ROOT_BINARY_DIR}/pack_service.cmake COPYONLY)
    configure_file(sdk/generate_service_info.cmake ${ROOT_BINARY_DIR}/generate_service_info.cmake COPYONLY)
endif()
