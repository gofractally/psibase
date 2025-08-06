function(add suffix)
    add_executable(VerifySig${suffix} src/VerifySig.cpp)
    target_mapped_include_directories(VerifySig${suffix} PUBLIC include)
    target_link_libraries(VerifySig${suffix} PUBLIC services_system${suffix} psibase-service${suffix})

    target_include_directories(VerifySig${suffix} PUBLIC ${ROOT_BINARY_DIR}/wasm/deps/include/botan-3)
    target_link_libraries(VerifySig${suffix} PUBLIC -lbotan-3 exception-stub${suffix} -Wl,-z,stack-size=32768 -Wl,--initial-memory=786432)
    set_target_properties(VerifySig${suffix} PROPERTIES
        RUNTIME_OUTPUT_NAME         VerifySig-prestart${suffix}
        RUNTIME_OUTPUT_DIRECTORY    ${CMAKE_CURRENT_BINARY_DIR}
    )
    add_custom_command(TARGET VerifySig${suffix} POST_BUILD
        COMMAND wasm-ctor-eval
            -c prestart
            --enable-sign-ext --enable-nontrapping-float-to-int --enable-simd --enable-bulk-memory
            VerifySig-prestart${suffix}.wasm
            -o ${ROOT_BINARY_DIR}/VerifySig${suffix}.wasm
    )
    psibase_schema(VerifySig${suffix} ${ROOT_BINARY_DIR}/VerifySig${suffix}-schema.json)
endfunction(add)

conditional_add()
