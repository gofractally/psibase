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

add_executable(PsitriDatabaseTests PsitriDatabaseTests.cpp)
target_compile_definitions(PsitriDatabaseTests PRIVATE PSIBASE_STORAGE_TEST_ROOT="${ROOT_BINARY_DIR}/storage-contract-databases")
target_link_directories(PsitriDatabaseTests PRIVATE ${ICU_LIBRARY_DIR})
target_link_libraries(PsitriDatabaseTests PRIVATE psibase Catch2::Catch2WithMain Threads::Threads)
add_test(NAME PsitriDatabaseTests COMMAND PsitriDatabaseTests)

# Keep the VM's trap handlers in charge; this bounded standalone consumer does
# not install Catch2 fatal-signal handlers over the native runtime.
add_executable(StorageTimeoutTests StorageTimeoutTests.cpp)
target_link_directories(StorageTimeoutTests PRIVATE ${ICU_LIBRARY_DIR})
target_link_libraries(StorageTimeoutTests PRIVATE psibase Threads::Threads)
add_test(NAME StorageTimeoutTests COMMAND StorageTimeoutTests)
set_tests_properties(StorageTimeoutTests PROPERTIES TIMEOUT 30 PROCESSORS 2)

if(APPLE)
  add_executable(DarwinCpuVmTrapTests DarwinCpuVmTrapTests.cpp)
  target_link_directories(DarwinCpuVmTrapTests PRIVATE ${ICU_LIBRARY_DIR})
  target_link_libraries(DarwinCpuVmTrapTests PRIVATE psibase Threads::Threads)
  add_test(NAME DarwinCpuVmTrapTests COMMAND DarwinCpuVmTrapTests)
  set_tests_properties(DarwinCpuVmTrapTests PROPERTIES TIMEOUT 30)
endif()
