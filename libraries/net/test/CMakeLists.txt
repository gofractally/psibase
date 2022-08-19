find_package(Threads REQUIRED)
find_package(Boost REQUIRED)

add_executable(test_random_timer test_random_timer.cpp)
target_include_directories(test_random_timer PUBLIC ../include)
target_link_libraries(test_random_timer PUBLIC catch2 Threads::Threads Boost::headers)

add_executable(test_mock_timer test_mock_timer.cpp mock_timer.cpp)
target_include_directories(test_mock_timer PUBLIC ../include)
target_link_libraries(test_mock_timer PUBLIC catch2 Threads::Threads Boost::headers)

#add_executable(test_cft_consensus test_cft_consensus.cpp mock_timer.cpp)
#target_include_directories(test_cft_consensus PUBLIC ../include)
#target_link_libraries(test_cft_consensus PUBLIC catch2)

#add_executable(test_direct_routing test_direct_routing.cpp mock_timer.cpp)
#target_include_directories(test_direct_routing PUBLIC ../include)
#target_link_libraries(test_direct_routing PUBLIC psio catch2)

#add_executable(test_integrated test_integrated.cpp mock_timer.cpp)
#target_include_directories(test_integrated PUBLIC ../include)
#target_link_libraries(test_integrated PUBLIC psio catch2 psibase)
