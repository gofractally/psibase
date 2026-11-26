function(add suffix)
    add_executable(VerifyBear1${suffix} src/VerifyBear1.cpp)
    target_mapped_include_directories(VerifyBear1${suffix} PUBLIC include)
    target_link_libraries(VerifyBear1${suffix} PUBLIC services_system${suffix} psibase-service-simple-malloc${suffix})

    # BearSSL's P-256 only; see the root CMakeLists.txt.
    target_include_directories(VerifyBear1${suffix} PUBLIC ${ROOT_BINARY_DIR}/wasm/deps/include)
    target_link_libraries(VerifyBear1${suffix} PUBLIC -lbearssl exception-stub${suffix} -Wl,-z,stack-size=32768)
    set_target_properties(VerifyBear1${suffix} PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${ROOT_BINARY_DIR})
    psibase_schema(VerifyBear1${suffix} OUTPUT_DIRECTORY ${ROOT_BINARY_DIR})
endfunction(add)

conditional_add()
