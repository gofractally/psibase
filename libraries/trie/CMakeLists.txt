cmake_minimum_required(VERSION 3.22)
project( trie )

find_package(Boost 1.78 REQUIRED COMPONENTS filesystem )
include_directories( ${Boost_INCLUDE_DIRS} ${CMAKE_CURRENT_SOURCE_DIR}/include ${CMAKE_CURRENT_SOURCE_DIR}/../psio/consthash/include)

add_executable( test db.cpp tdb.cpp palloc.cpp )
target_link_libraries( test PUBLIC Boost::filesystem )
target_compile_options( test PUBLIC -msse4.1 )
set_property( TARGET test PROPERTY CXX_STANDARD 20 )

add_executable( bigdb db.cpp big.cpp palloc.cpp )
target_link_libraries( bigdb PUBLIC Boost::filesystem )
target_compile_options( bigdb PUBLIC -msse4.1 )
set_property( TARGET bigdb PROPERTY CXX_STANDARD 20 )

add_executable( bigbmit db.cpp bigbmi.cpp palloc.cpp )
target_link_libraries( bigbmit PUBLIC Boost::filesystem )
target_compile_options( bigbmit PUBLIC -msse4.1 )
set_property( TARGET bigbmit PROPERTY CXX_STANDARD 20 )

