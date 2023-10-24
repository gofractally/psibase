function(add suffix)
    add_system_service("${suffix}" AuthSys src/AuthSys.cpp)
    add_system_service("${suffix}" RAuthSys src/RAuthSys.cpp)

    target_include_directories(RAuthSys${suffix} PUBLIC ${ROOT_BINARY_DIR}/wasm/deps/include/botan-3)
    target_link_libraries(RAuthSys${suffix} PUBLIC -lbotan-3 exception-stub${suffix})
endfunction(add)

conditional_add()
