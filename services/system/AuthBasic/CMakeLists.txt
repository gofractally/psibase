function(add suffix)
    add_system_service("${suffix}" AuthBasic src/AuthBasic.cpp)
    add_system_service("${suffix}" RAuthBasic src/RAuthBasic.cpp)

    target_include_directories(RAuthBasic${suffix} PUBLIC ${ROOT_BINARY_DIR}/wasm/deps/include/botan-3)
    target_link_libraries(RAuthBasic${suffix} PUBLIC -lbotan-3 exception-stub${suffix})
endfunction(add)

conditional_add()
