function(add suffix)
    add_system_service("${suffix}" VerifyK1 src/VerifyK1.cpp)
    target_link_libraries(VerifyK1${suffix} PUBLIC -lsecp256k1)
    set_target_properties(VerifyK1${suffix} PROPERTIES
        RUNTIME_OUTPUT_NAME         VerifyK1-prestart${suffix}
        RUNTIME_OUTPUT_DIRECTORY    ${CMAKE_CURRENT_BINARY_DIR}
    )
    add_custom_command(TARGET VerifyK1${suffix} POST_BUILD
        COMMAND wasm-ctor-eval
            -c prestart
            --enable-sign-ext --enable-nontrapping-float-to-int --enable-simd --enable-bulk-memory
            VerifyK1-prestart${suffix}.wasm
            -o ${ROOT_BINARY_DIR}/VerifyK1${suffix}.wasm
    )
endfunction(add)

conditional_add()
