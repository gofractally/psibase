cmake_minimum_required(VERSION 3.16.3)

project(triedent-fuzzing CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS ON)

add_library(triedent-fuzz
    ../../src/database.cpp
    ../../src/mapping.cpp
    ../../src/cache_allocator.cpp
    ../../src/gc_queue.cpp
    ../../src/region_allocator.cpp
    ../../src/ring_allocator.cpp
    ../temp_directory.cpp
    ../temp_database.cpp
    main.cpp
)
target_include_directories(triedent-fuzz PUBLIC ../../include)
if (TRIEDENT_FUZZING_ENABLED)
    target_compile_options(triedent-fuzz PUBLIC -fsanitize=fuzzer)
    target_link_options(triedent-fuzz PUBLIC -fsanitize=fuzzer)
    target_compile_definitions(triedent-fuzz PUBLIC -DTRIEDENT_FUZZING_ENABLED)
endif()

add_executable(fuzz_is_empty is_empty.cpp)
target_link_libraries(fuzz_is_empty PUBLIC triedent-fuzz)

add_executable(fuzz_is_equal_weak is_equal_weak.cpp)
target_link_libraries(fuzz_is_equal_weak PUBLIC triedent-fuzz)

add_executable(fuzz_take take.cpp)
target_link_libraries(fuzz_take PUBLIC triedent-fuzz)

add_executable(fuzz_splice splice.cpp)
target_link_libraries(fuzz_splice PUBLIC triedent-fuzz)
