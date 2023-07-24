find_package(Threads REQUIRED)
add_executable(WatchdogTests WatchdogTests.cpp)
target_link_libraries(WatchdogTests psibase catch2 Threads::Threads)
add_test(NAME WatchdogTests COMMAND WatchdogTests)
