cmake_minimum_required(VERSION 3.16)
project( trie )

find_package(Threads REQUIRED)
if(UNIX AND NOT APPLE)
    set(LINUX_LIBS rt)
endif()

find_package(Boost 1.75 REQUIRED COMPONENTS filesystem )

set(MDBX_OUTPUT_DIR ${CMAKE_BINARY_DIR}/mdbx)
set(MDBX_BUILD_TIMESTAMP unknown)
add_subdirectory(../../external/libmdbx libmdbx)

add_executable( test db.cpp tdb.cpp palloc.cpp )
target_link_libraries( test PUBLIC Boost::filesystem ${LINUX_LIBS} Threads::Threads )
target_compile_options( test PUBLIC -msse4.1 )
target_include_directories( test PUBLIC ${Boost_INCLUDE_DIRS} ${CMAKE_CURRENT_SOURCE_DIR}/include ${CMAKE_CURRENT_SOURCE_DIR}/../psio/consthash/include)
set_property( TARGET test PROPERTY CXX_STANDARD 20 )

add_executable( bigdb db.cpp big.cpp palloc.cpp )
target_link_libraries( bigdb PUBLIC Boost::filesystem ${LINUX_LIBS} Threads::Threads )
target_compile_options( bigdb PUBLIC -msse4.1 )
target_include_directories( bigdb PUBLIC ${Boost_INCLUDE_DIRS} ${CMAKE_CURRENT_SOURCE_DIR}/include ${CMAKE_CURRENT_SOURCE_DIR}/../psio/consthash/include)
set_property( TARGET bigdb PROPERTY CXX_STANDARD 20 )

add_executable( big-lmdbx big-lmdbx.cpp )
target_link_libraries( big-lmdbx PUBLIC Boost::filesystem ${LINUX_LIBS} Threads::Threads mdbx-static )
target_compile_options( big-lmdbx PUBLIC -msse4.1 )
target_include_directories( big-lmdbx PUBLIC 
    ${Boost_INCLUDE_DIRS} 
    ${CMAKE_CURRENT_SOURCE_DIR}/include 
    ${CMAKE_CURRENT_SOURCE_DIR}/../psio/consthash/include
    ../../external/libmdbx
)
set_property( TARGET big-lmdbx PROPERTY CXX_STANDARD 20 )

add_executable( bigbmit db.cpp bigbmi.cpp palloc.cpp )
target_link_libraries( bigbmit PUBLIC Boost::filesystem ${LINUX_LIBS} Threads::Threads )
target_compile_options( bigbmit PUBLIC -msse4.1 )
target_include_directories( bigbmit PUBLIC ${Boost_INCLUDE_DIRS} ${CMAKE_CURRENT_SOURCE_DIR}/include ${CMAKE_CURRENT_SOURCE_DIR}/../psio/consthash/include)
set_property( TARGET bigbmit PROPERTY CXX_STANDARD 20 )
