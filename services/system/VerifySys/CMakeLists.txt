function(add suffix)
    add_executable(VerifySys${suffix} src/VerifySys.cpp)
    target_mapped_include_directories(VerifySys${suffix} PUBLIC include)
    target_link_libraries(VerifySys${suffix} PUBLIC services_system${suffix} psibase-service${suffix})

    target_include_directories(VerifySys${suffix} PUBLIC ${ROOT_BINARY_DIR}/wasm/deps/include/botan-3)
    target_link_libraries(VerifySys${suffix} PUBLIC -lbotan-3 exception-stub${suffix} -Wl,-z,stack-size=32768 -Wl,--initial-memory=786432)
    set_target_properties(VerifySys${suffix} PROPERTIES
        RUNTIME_OUTPUT_NAME         VerifySys-prestart${suffix}
        RUNTIME_OUTPUT_DIRECTORY    ${CMAKE_CURRENT_BINARY_DIR}
    )
    add_custom_command(TARGET VerifySys${suffix} POST_BUILD
        COMMAND wasm-ctor-eval
            -c prestart
            --enable-sign-ext --enable-nontrapping-float-to-int --enable-simd --enable-bulk-memory
            VerifySys-prestart${suffix}.wasm
            -o ${ROOT_BINARY_DIR}/VerifySys${suffix}.wasm
    )
endfunction(add)

conditional_add()
