function(add suffix)
    add_system_service("${suffix}" VerifySys src/VerifySys.cpp)
    target_include_directories(VerifySys${suffix} PUBLIC ${ROOT_BINARY_DIR}/wasm/deps/include/botan-3)
    target_link_libraries(VerifySys${suffix} PUBLIC -lbotan-3 exception-stub${suffix})
endfunction(add)

conditional_add()
