function(add suffix)
    add_system_contract("${suffix}" verify_ec_sys src/verify_ec_sys.cpp)
    target_link_libraries(verify_ec_sys${suffix} PUBLIC -lsecp256k1)
    set_target_properties(verify_ec_sys${suffix} PROPERTIES
        RUNTIME_OUTPUT_NAME         verify_ec_sys-prestart${suffix}
        RUNTIME_OUTPUT_DIRECTORY    ${CMAKE_CURRENT_BINARY_DIR}
    )
    add_custom_command(TARGET verify_ec_sys${suffix} POST_BUILD
        COMMAND wasm-ctor-eval
            -c prestart
            verify_ec_sys-prestart${suffix}.wasm
            -o ${ROOT_BINARY_DIR}/verify_ec_sys${suffix}.wasm
    )
endfunction(add)

conditional_add()
