find_package(Threads REQUIRED)
find_package(Boost CONFIG REQUIRED)

link_directories( ${ICU_LIBRARY_DIR} )

add_executable(test_random_timer test_random_timer.cpp)
target_include_directories(test_random_timer PUBLIC ../include)
target_link_libraries(test_random_timer PUBLIC Catch2::Catch2WithMain Threads::Threads Boost::headers)

add_test(NAME test_random_timer COMMAND test_random_timer)

add_executable(test_mock_timer test_mock_timer.cpp mock_timer.cpp)
target_include_directories(test_mock_timer PUBLIC ../include)
target_link_libraries(test_mock_timer PUBLIC Catch2::Catch2WithMain Threads::Threads Boost::headers)

add_test(NAME test_mock_timer COMMAND test_mock_timer)

add_executable(test_shortest_path_routing test_shortest_path_routing.cpp connection_pair.cpp)
target_include_directories(test_shortest_path_routing PUBLIC ../include)
target_link_libraries(test_shortest_path_routing PUBLIC Catch2::Catch2 psibase Threads::Threads Boost::headers)
add_test(NAME test_shortest_path_routing COMMAND test_shortest_path_routing --log-filter "Severity >= debug")

add_executable(test_consensus test_consensus.cpp test_cft_consensus.cpp test_bft_consensus.cpp test_signatures.cpp mock_timer.cpp test_util.cpp main.cpp)
target_include_directories(test_consensus PUBLIC ../include)
target_link_libraries(test_consensus PUBLIC Catch2::Catch2 psibase services_system)

add_test(
    NAME test_consensus
    WORKING_DIRECTORY ${ROOT_BINARY_DIR}
    COMMAND test_consensus "[combined]"
)

add_test(
    NAME test_consensus-cft
    WORKING_DIRECTORY ${ROOT_BINARY_DIR}
    COMMAND test_consensus "[cft]"
)

add_test(
    NAME test_consensus-bft
    WORKING_DIRECTORY ${ROOT_BINARY_DIR}
    COMMAND test_consensus "[bft]"
)

set_tests_properties(
    test_consensus test_consensus-cft test_consensus-bft
    PROPERTIES TIMEOUT 900
)

add_executable(bft_fuzz bft_fuzz.cpp test_util.cpp fuzz.cpp)
target_include_directories(bft_fuzz PUBLIC ../include)
target_link_libraries(bft_fuzz PUBLIC Catch2::Catch2WithMain psibase services_system)

add_executable(joint_bft_fuzz joint_bft_fuzz.cpp test_util.cpp fuzz.cpp)
target_include_directories(joint_bft_fuzz PUBLIC ../include)
target_link_libraries(joint_bft_fuzz PUBLIC Catch2::Catch2WithMain psibase services_system)

set(PSIBASE_FUZZER "None" CACHE STRING "The fuzzer framework to use. Possible values: AFL None")

if (${PSIBASE_FUZZER} STREQUAL "AFL")
    find_program(AFL_CLANG_LTO afl-clang-lto++ REQUIRED)

    configure_file(afl-clang-lto++.in afl-clang-lto++ USE_SOURCE_PERMISSIONS @ONLY)

    foreach(target bft_fuzz joint_bft_fuzz)
        set_property(TARGET ${target} PROPERTY CXX_COMPILER_LAUNCHER /usr/bin/env;AFL_LLVM_ALLOWLIST=${CMAKE_CURRENT_SOURCE_DIR}/bft_fuzz.txt;${CMAKE_CURRENT_BINARY_DIR}/afl-clang-lto++)
        set_property(TARGET ${target} PROPERTY CXX_LINKER_LAUNCHER /usr/bin/env;AFL_LLVM_ALLOWLIST=${CMAKE_CURRENT_SOURCE_DIR}/bft_fuzz.txt;${CMAKE_CURRENT_BINARY_DIR}/afl-clang-lto++)
     endforeach()
endif()

#add_executable(test_direct_routing test_direct_routing.cpp mock_timer.cpp)
#target_include_directories(test_direct_routing PUBLIC ../include)
#target_link_libraries(test_direct_routing PUBLIC psio Catch2::Catch2WithMain)

#add_executable(test_integrated test_integrated.cpp mock_timer.cpp)
#target_include_directories(test_integrated PUBLIC ../include)
#target_link_libraries(test_integrated PUBLIC psio Catch2::Catch2WithMain psibase)
