add_compile_options( -Wall -Wstrict-aliasing -fstrict-aliasing )

if(DEFINED IS_NATIVE)
    link_directories(${ICU_LIBRARY_DIR})
    find_package(Threads REQUIRED)
    add_executable(psibase-common-tests
        name.cpp
    )
    target_link_libraries(psibase-common-tests psibase Catch2::Catch2WithMain Threads::Threads )
    set_target_properties(psibase-common-tests PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${ROOT_BINARY_DIR})
    native_test(psibase-common-tests)

    # rust_twins.cpp is native only: it compares the fixture that the Rust
    # tests read (rust/psibase/tests/psio_twins.rs) with the C++ declarations.
    add_executable(psibase-psio-tests psio.cpp leaf_types.cpp methods.cpp schema.cpp wrappers.cpp tables.cpp json.cpp graphql.cpp rust_twins.cpp)
    target_compile_definitions(psibase-psio-tests PRIVATE
        PSIBASE_RUST_TWINS_FIXTURE="${CMAKE_CURRENT_SOURCE_DIR}/rust-twins.json")
    target_link_libraries(psibase-psio-tests psibase Catch2::Catch2WithMain Threads::Threads )
endif()

if(DEFINED IS_WASM)
    add_executable(psibase-psio-tests psio.cpp leaf_types.cpp methods.cpp schema.cpp wrappers.cpp tables.cpp json.cpp graphql.cpp)
    target_link_libraries(psibase-psio-tests psibase catch2 boost psitestlib )
endif()

# PSIO as psibase uses it, natively and in a WASM guest (under psitest).
set_target_properties(psibase-psio-tests PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${ROOT_BINARY_DIR})
native_and_wasm_test(psibase-psio-tests)
