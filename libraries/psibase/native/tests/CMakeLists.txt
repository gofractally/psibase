find_package(Threads REQUIRED)


link_directories(WatchdogTests ${ICU_LIBRARY_DIR} )
add_executable(WatchdogTests WatchdogTests.cpp)
target_link_libraries(WatchdogTests psibase Catch2::Catch2WithMain Threads::Threads)
add_test(NAME WatchdogTests COMMAND WatchdogTests)

set_tests_properties(WatchdogTests PROPERTIES PROCESSORS 2)

add_executable(saturatingTests saturatingTests.cpp)
target_link_libraries(saturatingTests psibase)

add_executable(MountTests MountTests.cpp)
target_compile_definitions(MountTests PUBLIC -DCATCH_CONFIG_ENABLE_ALL_STRINGMAKERS=1)
target_link_libraries(MountTests psibase Catch2::Catch2WithMain Threads::Threads)
add_test(NAME MountTests COMMAND MountTests)
