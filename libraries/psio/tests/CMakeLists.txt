add_compile_options( -Wall -Wstrict-aliasing -fstrict-aliasing )

if(DEFINED IS_NATIVE)
    find_package(Threads REQUIRED)
    add_executable(psio-tests
        graphql.cpp
        psio_tests.cpp
#        reflect.cpp
#        flat_views.cpp
        benchmark.cpp
#        crypto.cpp
        test_fracpack.cpp
        test_bool.cpp
        test_char.cpp
        test_int8.cpp
        test_int16.cpp
        test_int32.cpp
        test_int64.cpp
        test_float.cpp
        test_struct.cpp
        test_std_array.cpp
        test_chrono.cpp
        test_view.cpp
        test_schema.cpp
        test_key.cpp
        test_name.cpp
    )
    target_link_libraries(psio-tests psio catch2 Threads::Threads )

    add_executable(generate_test_data generate_test_data.cpp)
    target_link_libraries(generate_test_data psio)
endif()

if(DEFINED IS_WASM)
    add_executable(psio-tests
        graphql.cpp
        psio_tests.cpp
#        reflect.cpp
#        flat_views.cpp
        benchmark.cpp
    )
    target_link_libraries(psio-tests psio catch2 boost psitestlib )
endif()

set_target_properties(psio-tests PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${ROOT_BINARY_DIR})

native_and_wasm_test(psio-tests)
