add_compile_options( -Wall -Wstrict-aliasing -fstrict-aliasing )

if(DEFINED IS_NATIVE)
    find_package(Threads REQUIRED)
    add_executable(psibase-common-tests
        psibase_common_tests.cpp
        name.cpp
    )
    target_link_libraries(psibase-common-tests psibase catch2 Threads::Threads )
endif()

set_target_properties(psibase-common-tests PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${ROOT_BINARY_DIR})

native_and_wasm_test(psibase-common-tests)
