add_executable(triedent-tests
    triedent-tests.cpp
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
