function(add suffix)
    add_system_service("${suffix}" VerifySys src/VerifySys.cpp)
    target_include_directories(VerifySys${suffix} PUBLIC ${ROOT_BINARY_DIR}/wasm/deps/include/botan-3)
    target_link_libraries(VerifySys${suffix} PUBLIC -lbotan-3)

    add_library(override-exceptions${suffix} INTERFACE)
    target_compile_options(override-exceptions${suffix} INTERFACE -fexceptions)
    target_link_libraries(VerifySys${suffix} PUBLIC override-exceptions${suffix})
endfunction(add)

conditional_add()
