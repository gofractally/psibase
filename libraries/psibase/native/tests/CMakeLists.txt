find_package(Threads REQUIRED)

add_executable(WatchdogTests WatchdogTests.cpp)
target_link_directories(WatchdogTests PUBLIC ${ICU_LIBRARY_DIR})
target_link_libraries(WatchdogTests psibase Catch2::Catch2WithMain Threads::Threads)
add_test(NAME WatchdogTests COMMAND WatchdogTests)

set_tests_properties(WatchdogTests PROPERTIES PROCESSORS 2)

add_executable(saturatingTests saturatingTests.cpp)
target_link_libraries(saturatingTests psibase)

add_executable(MountTests MountTests.cpp)
target_compile_definitions(MountTests PUBLIC -DCATCH_CONFIG_ENABLE_ALL_STRINGMAKERS=1)
target_link_libraries(MountTests psibase Catch2::Catch2WithMain Threads::Threads)
add_test(NAME MountTests COMMAND MountTests)

add_executable(SecretsTests SecretsTests.cpp)
target_compile_definitions(SecretsTests PUBLIC -DCATCH_CONFIG_ENABLE_ALL_STRINGMAKERS=1)
target_link_libraries(SecretsTests psibase Catch2::Catch2WithMain Threads::Threads)
add_test(NAME SecrestsTests COMMAND SecretsTests)

# The fixture exercises the actual registered-host ABI and native code writer.
find_program(PSIZAM_WAT2WASM NAMES wat2wasm REQUIRED)
set(PSIZAM_POLICY_WASM "${CMAKE_CURRENT_BINARY_DIR}/psizam-policy.wasm")
set(PSIZAM_SERVICE_WASM "${CMAKE_CURRENT_BINARY_DIR}/psizam-service.wasm")
foreach(fixture policy service)
    add_custom_command(OUTPUT "${CMAKE_CURRENT_BINARY_DIR}/psizam-${fixture}.wasm"
        COMMAND "${PSIZAM_WAT2WASM}" "${CMAKE_CURRENT_SOURCE_DIR}/psizam-${fixture}.wat"
            -o "${CMAKE_CURRENT_BINARY_DIR}/psizam-${fixture}.wasm"
        DEPENDS "psizam-${fixture}.wat" VERBATIM)
endforeach()
add_executable(PsizamTests PsizamTests.cpp "${PSIZAM_POLICY_WASM}" "${PSIZAM_SERVICE_WASM}")
target_compile_definitions(PsizamTests PRIVATE
    PSIBASE_PSIZAM_POLICY_WASM="${PSIZAM_POLICY_WASM}"
    PSIBASE_PSIZAM_SERVICE_WASM="${PSIZAM_SERVICE_WASM}")
target_link_libraries(PsizamTests psibase Catch2::Catch2WithMain Threads::Threads)
add_test(NAME PsizamTests COMMAND PsizamTests)
set_tests_properties(PsizamTests PROPERTIES TIMEOUT 30)
