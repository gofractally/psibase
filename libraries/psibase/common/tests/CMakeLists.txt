add_compile_options( -Wall -Wstrict-aliasing -fstrict-aliasing )

    link_directories(psibase-common-tests ${ICU_LIBRARY_DIR} )
if(DEFINED IS_NATIVE)
    find_package(Threads REQUIRED)
    add_executable(psibase-common-tests
        name.cpp
    )
    target_link_libraries(psibase-common-tests psibase Catch2::Catch2WithMain Threads::Threads )
endif()

set_target_properties(psibase-common-tests PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${ROOT_BINARY_DIR})

native_and_wasm_test(psibase-common-tests)
