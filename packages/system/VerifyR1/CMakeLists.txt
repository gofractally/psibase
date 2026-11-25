function(add suffix)
    add_executable(VerifyR1${suffix} src/VerifyR1.cpp)
    target_mapped_include_directories(VerifyR1${suffix} PUBLIC include)
    target_link_libraries(VerifyR1${suffix} PUBLIC services_system${suffix} psibase-service-simple-malloc${suffix})

    # BearSSL's P-256 only; see the root CMakeLists.txt.
    target_include_directories(VerifyR1${suffix} PUBLIC ${ROOT_BINARY_DIR}/wasm/deps/include)
    target_link_libraries(VerifyR1${suffix} PUBLIC -lbearssl exception-stub${suffix} -Wl,-z,stack-size=32768)
    set_target_properties(VerifyR1${suffix} PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${ROOT_BINARY_DIR})
    psibase_schema(VerifyR1${suffix} OUTPUT_DIRECTORY ${ROOT_BINARY_DIR})
endfunction(add)

conditional_add()
