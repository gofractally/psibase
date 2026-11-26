function(add suffix)
    add_executable(VerifyR1${suffix} src/VerifyR1.cpp)
    target_mapped_include_directories(VerifyR1${suffix} PUBLIC include)
    # Botan allocates, so this service has the full allocator, unlike the other verifiers.
    target_link_libraries(VerifyR1${suffix} PUBLIC services_system${suffix} psibase-service${suffix})

    # Botan only; see the root CMakeLists.txt.
    target_include_directories(VerifyR1${suffix} PUBLIC ${ROOT_BINARY_DIR}/wasm/deps/include/botan-3)
    # The initial memory (12 pages; 9 is the least that works) is enough for prestart to run without
    # growing memory, which wasm-ctor-eval cannot evaluate.
    target_link_libraries(VerifyR1${suffix} PUBLIC -lbotan-3 exception-stub${suffix} -Wl,-z,stack-size=65536 -Wl,--initial-memory=786432)
    set_target_properties(VerifyR1${suffix} PROPERTIES
        RUNTIME_OUTPUT_NAME         VerifyR1-prestart${suffix}
        RUNTIME_OUTPUT_DIRECTORY    ${CMAKE_CURRENT_BINARY_DIR}
    )
    # Setting up the curve costs several times a verification, so it is done
    # here once: prestart is evaluated and the deployed module starts from the
    # memory it left. check-prestart fails the build if prestart was not
    # evaluated to the end (the export would still be there). wasm-opt then
    # drops the code that only prestart reached.
    #
    # The features are named one by one: --all-features makes binaryen emit
    # an encoding that wasmtime rejects.
    add_custom_command(TARGET VerifyR1${suffix} POST_BUILD
        COMMAND wasm-ctor-eval
            -c prestart
            --enable-bulk-memory --enable-sign-ext --enable-nontrapping-float-to-int
            --enable-mutable-globals --enable-wide-arithmetic --enable-multivalue
            VerifyR1-prestart${suffix}.wasm
            -o VerifyR1-evaluated${suffix}.wasm
        COMMAND ${CMAKE_COMMAND}
            -DWASM=VerifyR1-evaluated${suffix}.wasm
            -P ${CMAKE_CURRENT_SOURCE_DIR}/check-prestart.cmake
        COMMAND ${ROOT_SOURCE_DIR}/libraries/psibase/sdk/psibase-wasm-opt -O3
            VerifyR1-evaluated${suffix}.wasm
            -o ${ROOT_BINARY_DIR}/VerifyR1${suffix}.wasm
        BYPRODUCTS ${ROOT_BINARY_DIR}/VerifyR1${suffix}.wasm
    )
    psibase_schema(VerifyR1${suffix} OUTPUT_DIRECTORY ${ROOT_BINARY_DIR})

    # For a test only, never packaged: the same code without pre-initialization.
    add_executable(VerifyR1NotPreinitialized${suffix} src/VerifyR1.cpp)
    target_compile_definitions(VerifyR1NotPreinitialized${suffix} PRIVATE VERIFY_R1_NOT_PREINITIALIZED)
    target_mapped_include_directories(VerifyR1NotPreinitialized${suffix} PUBLIC include)
    target_link_libraries(VerifyR1NotPreinitialized${suffix} PUBLIC services_system${suffix} psibase-service${suffix})
    target_include_directories(VerifyR1NotPreinitialized${suffix} PUBLIC ${ROOT_BINARY_DIR}/wasm/deps/include/botan-3)
    target_link_libraries(VerifyR1NotPreinitialized${suffix} PUBLIC -lbotan-3 exception-stub${suffix} -Wl,-z,stack-size=65536 -Wl,--initial-memory=786432)
    set_target_properties(VerifyR1NotPreinitialized${suffix} PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${ROOT_BINARY_DIR})
endfunction(add)

conditional_add()
