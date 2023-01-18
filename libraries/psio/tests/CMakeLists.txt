add_compile_options( -Wall -Wstrict-aliasing -fstrict-aliasing )

if(DEFINED IS_NATIVE)
    find_package(Threads REQUIRED)
    add_executable(psio-tests
        graphql.cpp
        fracpack.cpp
        psio_tests.cpp
        reflect.cpp
#        flat_views.cpp
        benchmark.cpp
#        crypto.cpp
        test_fracpack.cpp
    )
    target_link_libraries(psio-tests psio catch2 Threads::Threads )
endif()

if(DEFINED IS_WASM)
    add_executable(psio-tests
        graphql.cpp
        fracpack.cpp
        psio_tests.cpp
        reflect.cpp
#        flat_views.cpp
        benchmark.cpp
    )
    target_link_libraries(psio-tests psio catch2 boost psitestlib )
endif()

set_target_properties(psio-tests PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${ROOT_BINARY_DIR})

native_and_wasm_test(psio-tests)
