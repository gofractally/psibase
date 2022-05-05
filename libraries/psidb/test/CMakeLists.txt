add_executable(test_cursor test_cursor.cpp)
target_link_libraries(test_cursor psidb catch2)

add_executable(test_transaction test_transaction.cpp)
target_link_libraries(test_transaction psidb catch2)

add_executable(test_allocator test_allocator.cpp)
target_link_libraries(test_allocator psidb catch2)

add_executable(test_threaded test_threaded.cpp)
target_link_libraries(test_threaded psidb catch2)
