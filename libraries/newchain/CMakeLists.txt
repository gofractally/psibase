find_package(OpenSSL REQUIRED Crypto)

function(add suffix)
    add_library(newchain${suffix})
    target_link_libraries(newchain${suffix} PUBLIC abieos${suffix} boost OpenSSL::Crypto)
    target_include_directories(newchain${suffix} PUBLIC include)
    target_sources(newchain${suffix} PRIVATE
        src/crypto.cpp
    )
    if(DEFINED IS_NATIVE)
        target_link_libraries(newchain${suffix} PUBLIC chain)
        target_sources(newchain${suffix} PRIVATE
            src/block_context.cpp
            src/transaction_context.cpp
        )
    endif()
endfunction()

add("")
if(DEFINED IS_WASM)
    add("-debug")
endif()
