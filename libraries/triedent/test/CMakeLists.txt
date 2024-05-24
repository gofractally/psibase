add_executable(triedent-tests
    triedent-tests.cpp
    test_range_compare.cpp
    test_mapping.cpp
    test_gc_queue.cpp
    test_location_lock.cpp
    test_object_db.cpp
    test_ring_allocator.cpp
    test_region_allocator.cpp
    test_cache_allocator.cpp
    temp_directory.cpp)
target_link_libraries(triedent-tests PUBLIC catch2 triedent)
target_include_directories(triedent-tests PUBLIC ${Boost_INCLUDE_DIRS})
set_target_properties(triedent-tests PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${ROOT_BINARY_DIR})
native_test(triedent-tests)

add_executable(triedent-tests-bigdb big.cpp)
target_link_libraries(triedent-tests-bigdb PUBLIC Boost::program_options triedent)
target_include_directories(triedent-tests-bigdb PUBLIC ${Boost_INCLUDE_DIRS})
set_target_properties(triedent-tests-bigdb PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${ROOT_BINARY_DIR})

set(TRIEDENT_FUZZ_CXX_COMPILER "" CACHE STRING "The compiler to use for fuzzing")

if (TRIEDENT_FUZZ_CXX_COMPILER)

    ExternalProject_Add(
        triedent-fuzz
        SOURCE_DIR ${CMAKE_CURRENT_SOURCE_DIR}/fuzz
        BINARY_DIR ${CMAKE_CURRENT_BINARY_DIR}/fuzz
        CMAKE_ARGS
            -DCMAKE_CXX_COMPILER=${TRIEDENT_FUZZ_CXX_COMPILER}
            -DCMAKE_BUILD_TYPE=Debug
            -DTRIEDENT_FUZZING_ENABLED=1
        BUILD_ALWAYS 1
        INSTALL_COMMAND ""
    )

else()

    add_subdirectory(fuzz)

endif()
