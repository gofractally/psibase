function(add suffix)
    add_executable(VerifyK1${suffix} src/VerifyK1.cpp)
    target_mapped_include_directories(VerifyK1${suffix} PUBLIC include)
    target_link_libraries(VerifyK1${suffix} PUBLIC services_system${suffix} psibase-service-simple-malloc${suffix})

    # libsecp256k1 only; see the root CMakeLists.txt.
    target_include_directories(VerifyK1${suffix} PUBLIC ${ROOT_BINARY_DIR}/wasm/deps/include)
    target_compile_definitions(VerifyK1${suffix} PUBLIC SECP256K1_STATIC)
    target_link_libraries(VerifyK1${suffix} PUBLIC -lsecp256k1 exception-stub${suffix} -Wl,-z,stack-size=32768)
    set_target_properties(VerifyK1${suffix} PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${ROOT_BINARY_DIR})
    psibase_schema(VerifyK1${suffix} OUTPUT_DIRECTORY ${ROOT_BINARY_DIR})
endfunction(add)

conditional_add()
