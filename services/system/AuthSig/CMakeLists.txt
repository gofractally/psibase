function(add suffix)
    add_system_service("${suffix}" AuthSig src/AuthSig.cpp)
    add_system_service("${suffix}" RAuthSig src/RAuthSig.cpp)

    target_include_directories(RAuthSig${suffix} PUBLIC ${ROOT_BINARY_DIR}/wasm/deps/include/botan-3)
    target_link_libraries(RAuthSig${suffix} PUBLIC -lbotan-3 exception-stub${suffix})
endfunction(add)

conditional_add()
