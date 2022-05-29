cmake_minimum_required(VERSION 3.16)
project( trie )

find_package(Threads REQUIRED)
if(UNIX AND NOT APPLE)
    set(LINUX_LIBS rt)
endif()

find_package(Boost 1.75 REQUIRED COMPONENTS )

set(MDBX_OUTPUT_DIR ${CMAKE_BINARY_DIR}/mdbx)
set(MDBX_BUILD_TIMESTAMP unknown)
add_subdirectory(../../external/libmdbx libmdbx)

add_executable( test database.cpp ring_alloc.cpp object_arena.cpp t2.cpp  )
target_link_libraries( test PUBLIC ${LINUX_LIBS} Threads::Threads )
target_compile_options( test PUBLIC -msse4.1 )
target_include_directories( test PUBLIC ${Boost_INCLUDE_DIRS} ${CMAKE_CURRENT_SOURCE_DIR}/include ${CMAKE_CURRENT_SOURCE_DIR}/../psio/consthash/include)
set_property( TARGET test PROPERTY CXX_STANDARD 20 )


add_executable( bigdb ring_alloc.cpp database.cpp object_arena.cpp big.cpp  )
target_link_libraries( bigdb PUBLIC ${LINUX_LIBS} Threads::Threads )
target_compile_options( bigdb PUBLIC -msse4.1 )
target_include_directories( bigdb PUBLIC ${Boost_INCLUDE_DIRS} ${CMAKE_CURRENT_SOURCE_DIR}/include ${CMAKE_CURRENT_SOURCE_DIR}/../psio/consthash/include)
set_property( TARGET bigdb PROPERTY CXX_STANDARD 20 )

add_executable( swaptest database.cpp swap.cpp ring_alloc.cpp object_arena.cpp  )
target_link_libraries( swaptest PUBLIC ${LINUX_LIBS} Threads::Threads )
target_compile_options( swaptest PUBLIC -msse4.1 )
target_include_directories( swaptest PUBLIC ${Boost_INCLUDE_DIRS} ${CMAKE_CURRENT_SOURCE_DIR}/include ${CMAKE_CURRENT_SOURCE_DIR}/../psio/consthash/include)
set_property( TARGET swaptest PROPERTY CXX_STANDARD 20 )
