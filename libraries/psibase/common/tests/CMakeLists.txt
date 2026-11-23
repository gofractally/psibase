add_compile_options( -Wall -Wstrict-aliasing -fstrict-aliasing )

    link_directories(psibase-common-tests ${ICU_LIBRARY_DIR} )
if(DEFINED IS_NATIVE)
    find_package(Threads REQUIRED)
    add_executable(psibase-common-tests
        name.cpp
    )
    target_link_libraries(psibase-common-tests psibase Catch2::Catch2WithMain Threads::Threads )
    add_executable(action-name-probe action_name_probe.cpp)
    target_link_libraries(action-name-probe PRIVATE psio)
    set_target_properties(action-name-probe PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${ROOT_BINARY_DIR})
    add_library(action-name-constexpr OBJECT action_name_constexpr.cpp)
    target_link_libraries(action-name-constexpr PRIVATE psio)
    add_library(action-name-dispatch OBJECT action_name_dispatch.cpp)
    target_link_libraries(action-name-dispatch PRIVATE psibase)
endif()

set_target_properties(psibase-common-tests PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${ROOT_BINARY_DIR})

native_and_wasm_test(psibase-common-tests)
