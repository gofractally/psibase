cmake_minimum_required(VERSION 3.16.3)
project(psidk)

get_filename_component(root ${CMAKE_CURRENT_LIST_DIR}/../../.. REALPATH)

get_filename_component(PSITEST_EXECUTABLE ${root}/../../bin/psitest REALPATH)

separate_arguments(release-cxx-flags NATIVE_COMMAND ${CMAKE_CXX_FLAGS_RELEASE})
separate_arguments(release-link-flags NATIVE_COMMAND ${CMAKE_EXE_LINKER_FLAGS_RELEASE})
add_library(wasm-base INTERFACE)
target_compile_options(wasm-base INTERFACE -fno-exceptions -DCOMPILING_WASM -mthread-model single $<$<CONFIG:Mixed>:${release-cxx-flags}>)
target_link_options(wasm-base INTERFACE $<$<CONFIG:Mixed>:${release-link-flags}>)

separate_arguments(debug-cxx-flags NATIVE_COMMAND ${CMAKE_CXX_FLAGS_DEBUG})
separate_arguments(debug-link-flags NATIVE_COMMAND ${CMAKE_EXE_LINKER_FLAGS_DEBUG})
add_library(wasm-base-debug INTERFACE)
target_compile_options(wasm-base-debug INTERFACE -fno-exceptions -DCOMPILING_WASM -mthread-model single $<$<CONFIG:Mixed>:${debug-cxx-flags}>)
target_link_options(wasm-base-debug INTERFACE $<$<CONFIG:Mixed>:${debug-link-flags}>)

add_library(boost INTERFACE)
target_include_directories(boost INTERFACE ${root}/include)

find_package(Catch2 REQUIRED)

function(add_libs suffix)

    if(suffix)
        set(lib-suffix ${suffix})
    else()
        set(lib-suffix $<$<CONFIG:Debug>:-debug>)
    endif()

    add_library(psio${suffix} INTERFACE)
    target_include_directories(psio${suffix} INTERFACE ${root}/include)
    target_link_libraries(psio${suffix} INTERFACE
        -L${root}/lib
        -lpsio
        boost
        wasm-base${suffix}
    )
    target_compile_features(psio${suffix} INTERFACE cxx_std_23)

    add_library(psibase${suffix} INTERFACE)
    target_include_directories(psibase${suffix} INTERFACE ${root}/include)
    target_link_libraries(psibase${suffix} INTERFACE
        -L${root}/lib
        wasm-base${suffix}
        -lpsibase${lib-suffix}
        -lcrypto
        psio${suffix}
        boost
    )

    add_library(psibase-service-base${suffix} INTERFACE)
    target_include_directories(psibase-service-base${suffix} INTERFACE ${root}/include/wasm32-psibase ${root}/include)
    target_link_libraries(psibase-service-base${suffix} INTERFACE
        -L${root}/lib
        psibase${suffix}
        -lpsibase-service-base${lib-suffix}
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
    add_library(Psibase::service-simple-malloc${suffix} INTERFACE IMPORTED)
    target_link_libraries(Psibase::service-simple-malloc${suffix} INTERFACE
        -L${root}/lib
        psibase-service-base${suffix}
        -lc++
        -lc++abi-replacements${lib-suffix}
        -lc-simple-malloc${lib-suffix}
        -lpsibase-service-wasi-polyfill${lib-suffix}
        ${LIBCLANG_RT_BUILTINS}
    )

    # Service with full malloc/free
    add_library(Psibase::service-full-malloc${suffix} INTERFACE IMPORTED)
    target_link_libraries(Psibase::service-full-malloc${suffix} INTERFACE
        -L${root}/lib
        psibase-service-base${suffix}
        -lc++
        -lc++abi-replacements${lib-suffix}
        -lc
        -lpsibase-service-wasi-polyfill${lib-suffix}
        ${LIBCLANG_RT_BUILTINS}
    )

    add_library(Psibase::service${suffix} INTERFACE IMPORTED)
    target_link_libraries(Psibase::service${suffix} INTERFACE Psibase::service-simple-malloc${suffix})

    add_library(Psibase::test${suffix} INTERFACE IMPORTED)
    target_compile_options(Psibase::test${suffix} INTERFACE -DCOMPILING_TESTS)
    target_link_libraries(Psibase::test${suffix} INTERFACE
        -L${root}/lib
        psibase${suffix}
        Catch2::Catch2
        boost
        -lz
        -lc++
        -lc++abi
        -lc
        -lpsitestlib${lib-suffix}
        -lSpki${suffix}
        -lPrivateKeyInfo${suffix}
        ${LIBCLANG_RT_BUILTINS}
        ${WASI_SDK_PREFIX}/share/wasi-sysroot/lib/wasm32-wasip1/crt1.o
    )
    target_link_options(Psibase::test${suffix} INTERFACE
        -Wl,--entry,_start
        -nostdlib
    )

    add_library(Spki${suffix} INTERFACE IMPORTED)
    target_link_libraries(Spki${suffix} INTERFACE 
        -L${root}/lib
        -lbotan-3 
        services_system${suffix} 
        psibase${suffix} 
        exception-stub${suffix}
        -lSpki${suffix}
    )
    target_include_directories(Spki${suffix} INTERFACE 
        ${root}/include/services/system/AuthSig/include
        ${root}/include/botan-3
    )

    add_library(PrivateKeyInfo${suffix} INTERFACE IMPORTED)
    target_link_libraries(PrivateKeyInfo${suffix} INTERFACE 
        -L${root}/lib
        -lbotan-3 
        services_system${suffix} 
        psibase${suffix} 
        exception-stub${suffix}
        -lPrivateKeyInfo${suffix}
    )
    target_include_directories(PrivateKeyInfo${suffix} INTERFACE 
        ${root}/include/services/system/AuthSig/include
        ${root}/include/botan-3
    )

endfunction()

add_libs("")
add_libs("-debug")

include(${CMAKE_CURRENT_LIST_DIR}/pack_service.cmake)
