find_package(Threads REQUIRED)


link_directories(WatchdogTests ${ICU_LIBRARY_DIR} )
add_executable(WatchdogTests WatchdogTests.cpp)
target_link_libraries(WatchdogTests psibase catch2 Threads::Threads)
add_test(NAME WatchdogTests COMMAND WatchdogTests)

set_tests_properties(WatchdogTests PROPERTIES PROCESSORS 2)

add_executable(saturatingTests saturatingTests.cpp)
target_link_libraries(saturatingTests psibase)
