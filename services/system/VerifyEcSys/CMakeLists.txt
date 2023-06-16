function(add suffix)
    add_system_service("${suffix}" VerifyEcSys src/VerifyEcSys.cpp)
    target_link_libraries(VerifyEcSys${suffix} PUBLIC -lsecp256k1)
    set_target_properties(VerifyEcSys${suffix} PROPERTIES
        RUNTIME_OUTPUT_NAME         VerifyEcSys-prestart${suffix}
        RUNTIME_OUTPUT_DIRECTORY    ${CMAKE_CURRENT_BINARY_DIR}
    )
    add_custom_command(TARGET VerifyEcSys${suffix} POST_BUILD
        COMMAND wasm-ctor-eval
            -c prestart
            --enable-bulk-memory
            VerifyEcSys-prestart${suffix}.wasm
            -o ${ROOT_BINARY_DIR}/VerifyEcSys${suffix}.wasm
    )
endfunction(add)

conditional_add()
