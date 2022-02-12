find_package(OpenSSL REQUIRED Crypto)

function(add suffix)
    add_library(newchain${suffix})
    target_link_libraries(newchain${suffix} PUBLIC abieos${suffix} boost OpenSSL::Crypto)
    target_include_directories(newchain${suffix} PUBLIC include)
    target_sources(newchain${suffix} PRIVATE
        src/crypto.cpp
    )
endfunction()

add("")
if(DEFINED IS_WASM)
    add("-debug")
endif()
