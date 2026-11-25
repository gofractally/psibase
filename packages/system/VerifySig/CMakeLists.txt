function(add suffix)
    add_executable(VerifySig${suffix} src/VerifySig.cpp)
    target_mapped_include_directories(VerifySig${suffix} PUBLIC include)
    target_link_libraries(VerifySig${suffix} PUBLIC services_system${suffix} psibase-service-simple-malloc${suffix})

    # libsecp256k1 (secp256k1) and BearSSL (P-256); see the root CMakeLists.txt.
    target_include_directories(VerifySig${suffix} PUBLIC ${ROOT_BINARY_DIR}/wasm/deps/include)
    target_compile_definitions(VerifySig${suffix} PUBLIC SECP256K1_STATIC)
    target_link_libraries(VerifySig${suffix} PUBLIC -lsecp256k1 -lbearssl exception-stub${suffix} -Wl,-z,stack-size=32768)
    set_target_properties(VerifySig${suffix} PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${ROOT_BINARY_DIR})
    psibase_schema(VerifySig${suffix} OUTPUT_DIRECTORY ${ROOT_BINARY_DIR})
endfunction(add)

conditional_add()
