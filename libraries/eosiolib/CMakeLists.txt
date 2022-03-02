enable_testing()

function(add_libs suffix)
    add_library(simple-malloc${suffix})
    target_link_libraries(simple-malloc${suffix} PUBLIC wasm-base${suffix})
    target_sources(simple-malloc${suffix} PRIVATE simple_malloc.cpp)
    add_custom_command(
        TARGET simple-malloc${suffix}
        PRE_LINK
        COMMAND cp ${WASI_SDK_PREFIX}/share/wasi-sysroot/lib/wasm32-wasi/libc.a libc-no-malloc${suffix}.a
        COMMAND ${WASI_SDK_PREFIX}/bin/llvm-ar d libc-no-malloc${suffix}.a dlmalloc.o
    )

    add_library(c++abi-replacements${suffix})
    target_link_libraries(c++abi-replacements${suffix} PUBLIC wasm-base${suffix})
    target_sources(c++abi-replacements${suffix} PRIVATE abort_message.cpp)
    add_custom_command(
        TARGET c++abi-replacements${suffix}
        PRE_LINK
        COMMAND cp ${WASI_SDK_PREFIX}/share/wasi-sysroot/lib/wasm32-wasi/libc++abi.a libc++abi-shrunk${suffix}.a
        COMMAND ${WASI_SDK_PREFIX}/bin/llvm-ar d libc++abi-shrunk${suffix}.a abort_message.cpp.o
    )

    add_library(eosio-contracts-wasi-polyfill${suffix})
    target_link_libraries(eosio-contracts-wasi-polyfill${suffix} PUBLIC wasm-base${suffix})
    target_sources(eosio-contracts-wasi-polyfill${suffix} PRIVATE
        contracts/wasi-polyfill/__wasi_fd_fdstat_get.cpp
        contracts/wasi-polyfill/__wasi_fd_close.cpp
        contracts/wasi-polyfill/__wasi_fd_seek.cpp
        contracts/wasi-polyfill/__wasi_fd_write.cpp
    )
endfunction(add_libs)

add_libs("")
add_libs("-debug")
add_libs("-clsdk")
add_libs("-debug-clsdk")
