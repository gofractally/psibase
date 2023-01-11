if(BUILD_STATIC)
    set(OPENSSL_USE_STATIC_LIBS TRUE)
endif()
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
        target_mapped_include_directories(psibase${suffix} PUBLIC common/include)

        # wasi-sdk-16+ uses -mbulk-memory which we do not support
        add_library(cstring-objects${suffix} OBJECT service/src/memcpy.c service/src/memmove.c service/src/memset.c)
        target_link_libraries(cstring-objects${suffix} PUBLIC wasm-base${suffix})
        set(cstring-remove memcpy.o memmove.o memset.o)
        set(cstring-add $<TARGET_OBJECTS:cstring-objects${suffix}>)
        set(cstring-target cstring-objects${suffix} $<TARGET_OBJECTS:cstring-objects${suffix}>)

        add_library(simple-malloc-objects${suffix} OBJECT service/src/simple_malloc.cpp)
        target_link_libraries(simple-malloc-objects${suffix} PUBLIC wasm-base${suffix})
        add_custom_target(c-simple-malloc${suffix} ALL DEPENDS libc-simple-malloc${suffix}.a)
        add_custom_command(
            OUTPUT libc-simple-malloc${suffix}.a
            DEPENDS simple-malloc-objects${suffix} ${cstring-target}
            COMMAND cp ${WASI_SDK_PREFIX}/share/wasi-sysroot/lib/wasm32-wasi/libc.a libc-simple-malloc${suffix}.a
            COMMAND ${WASI_SDK_PREFIX}/bin/llvm-ar d libc-simple-malloc${suffix}.a dlmalloc.o ${cstring-remove}
            COMMAND ${WASI_SDK_PREFIX}/bin/llvm-ar rs libc-simple-malloc${suffix}.a $<TARGET_OBJECTS:simple-malloc-objects${suffix}> ${cstring-add}
            COMMAND_EXPAND_LISTS
        )

        add_custom_target(c-replacement${suffix} ALL DEPENDS libc${suffix}.a)
        add_custom_command(
            OUTPUT libc${suffix}.a
            DEPENDS ${cstring-target}
            COMMAND cp ${WASI_SDK_PREFIX}/share/wasi-sysroot/lib/wasm32-wasi/libc.a libc${suffix}.a
            COMMAND ${WASI_SDK_PREFIX}/bin/llvm-ar d libc${suffix}.a ${cstring-remove}
            COMMAND ${WASI_SDK_PREFIX}/bin/llvm-ar rs libc${suffix}.a ${cstring-add}
            COMMAND_EXPAND_LISTS
        )

        add_library(c++abi-objects${suffix} OBJECT service/src/abort_message.cpp)
        target_link_libraries(c++abi-objects${suffix} PUBLIC wasm-base${suffix})
        add_custom_target(c++abi-replacements${suffix} ALL DEPENDS libc++abi-replacements${suffix}.a)
        add_custom_command(
            OUTPUT libc++abi-replacements${suffix}.a
            DEPENDS c++abi-objects${suffix}
            COMMAND cp ${WASI_SDK_PREFIX}/share/wasi-sysroot/lib/wasm32-wasi/libc++abi.a libc++abi-replacements${suffix}.a
            COMMAND ${WASI_SDK_PREFIX}/bin/llvm-ar rs libc++abi-replacements${suffix}.a $<TARGET_OBJECTS:c++abi-objects${suffix}>
        )

        add_library(psibase-service-wasi-polyfill${suffix})
        target_link_libraries(psibase-service-wasi-polyfill${suffix} PUBLIC wasm-base${suffix})
        target_sources(psibase-service-wasi-polyfill${suffix} PRIVATE
            service/src/ossl.c
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
            psibase-service-base${suffix}
            -lc++
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
            service/src/ossl.c
            tester/src/tester_intrinsics.cpp
            tester/src/wasi_polyfill/__wasi_args_get.cpp
            tester/src/wasi_polyfill/__wasi_args_sizes_get.cpp
            tester/src/wasi_polyfill/__wasi_clock_time_get.cpp
            tester/src/wasi_polyfill/__wasi_environ_get.cpp
            tester/src/wasi_polyfill/__wasi_environ_sizes_get.cpp
            tester/src/wasi_polyfill/__wasi_fd_close.cpp
            tester/src/wasi_polyfill/__wasi_fd_fdstat_get.cpp
            tester/src/wasi_polyfill/__wasi_fd_fdstat_set_flags.cpp
            tester/src/wasi_polyfill/__wasi_fd_filestat_get.cpp
            tester/src/wasi_polyfill/__wasi_fd_prestat_dir_name.cpp
            tester/src/wasi_polyfill/__wasi_fd_prestat_get.cpp
            tester/src/wasi_polyfill/__wasi_fd_read.cpp
            tester/src/wasi_polyfill/__wasi_fd_readdir.cpp
            tester/src/wasi_polyfill/__wasi_fd_seek.cpp
            tester/src/wasi_polyfill/__wasi_fd_write.cpp
            tester/src/wasi_polyfill/__wasi_path_filestat_get.cpp
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
            -L${CMAKE_CURRENT_BINARY_DIR}
            -lc
            ${LIBCLANG_RT_BUILTINS}
            ${WASI_SDK_PREFIX}/share/wasi-sysroot/lib/wasm32-wasi/crt1.o
        )
        add_dependencies(psitestlib${suffix} c-replacement)
        target_mapped_include_directories(psitestlib${suffix} PUBLIC
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
        target_mapped_include_directories(psitestlib${suffix} PRIVATE
            ../../services/system/VerifyEcSys/include
        )
        target_link_options(psitestlib${suffix} PUBLIC
            -Wl,--entry,_start
            -nostdlib
        )
    endif()

    if(DEFINED IS_NATIVE)
        find_package(Boost 1.67 REQUIRED COMPONENTS filesystem log)

        target_link_libraries(psibase${suffix} PUBLIC eos-vm triedent secp256k1 Boost::filesystem Boost::log)
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
endif()

if(IS_WASM)
    install(DIRECTORY common/include/psibase TYPE INCLUDE COMPONENT libpsibase FILES_MATCHING PATTERN "*.hpp")
    install(DIRECTORY tester/include/psibase TYPE INCLUDE COMPONENT libpsibase FILES_MATCHING PATTERN "*.hpp")
    install(PROGRAMS sdk/psidk-cmake-args TYPE BIN COMPONENT libpsibase)
    install(FILES sdk/psibase-config.cmake DESTINATION ${CMAKE_INSTALL_LIBDIR}/cmake/psidk COMPONENT libpsibase)
    install(FILES ${CMAKE_CURRENT_BINARY_DIR}/libc++abi-replacements.a ${CMAKE_CURRENT_BINARY_DIR}/libc++abi-replacements-debug.a TYPE LIB COMPONENT libpsibase)
    install(FILES ${CMAKE_CURRENT_BINARY_DIR}/libc-simple-malloc.a ${CMAKE_CURRENT_BINARY_DIR}/libc-simple-malloc-debug.a TYPE LIB COMPONENT libpsibase)
    install(FILES ${CMAKE_CURRENT_BINARY_DIR}/libc.a ${CMAKE_CURRENT_BINARY_DIR}/libc-debug.a TYPE LIB COMPONENT libpsibase)
    install(TARGETS psibase psibase-service-base psibase-service-wasi-polyfill psitestlib
        psibase-debug psibase-service-base-debug psibase-service-wasi-polyfill-debug psitestlib-debug
        ARCHIVE COMPONENT libpsibase)
    install(FILES sdk/toolchain.cmake DESTINATION ${CMAKE_INSTALL_DATADIR}/psibase/cmake COMPONENT libpsibase)
    install(FILES sdk/WASI.cmake DESTINATION ${CMAKE_INSTALL_DATADIR}/wasi-sysroot/share/cmake/Modules/Platform COMPONENT libpsibase)

    configure_file(sdk/psibase-config.cmake.build ${ROOT_BINARY_DIR}/psibase-config.cmake @ONLY)
    configure_file(sdk/psidk-cmake-args.build ${ROOT_BINARY_DIR}/psidk-cmake-args @ONLY)
    configure_file(sdk/toolchain.cmake ${ROOT_BINARY_DIR}/toolchain.cmake COPYONLY)
    configure_file(sdk/WASI.cmake ${ROOT_BINARY_DIR}/cmake/Platform/WASI.cmake COPYONLY)
endif()
