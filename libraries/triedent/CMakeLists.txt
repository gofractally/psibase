cmake_minimum_required(VERSION 3.16)
project(trie)

include(ExternalProject)

find_package(Threads REQUIRED)
if(UNIX AND NOT APPLE)
    set(LINUX_LIBS rt)
endif()

find_package(Boost 1.75 REQUIRED COMPONENTS program_options)

ExternalProject_Add(catch2-ext
    SOURCE_DIR ${CMAKE_CURRENT_SOURCE_DIR}/../../external/Catch2
    BINARY_DIR catch2
    TEST_EXCLUDE_FROM_MAIN 1
    EXCLUDE_FROM_ALL 1
    ${CATCH2_INSTALL_COMMAND}
    CMAKE_ARGS
        -DCMAKE_BUILD_TYPE=${CMAKE_BUILD_TYPE}
        -DCMAKE_TARGET_MESSAGES=${CMAKE_TARGET_MESSAGES}
        -DCMAKE_INSTALL_PREFIX=${CMAKE_BINARY_DIR}/catch2
        -DCATCH_INSTALL_DOCS=FALSE
        -DCATCH_INSTALL_EXTRAS=FALSE
        -DCMAKE_C_COMPILER_LAUNCHER=${CMAKE_C_COMPILER_LAUNCHER}
        -DCMAKE_CXX_COMPILER_LAUNCHER=${CMAKE_CXX_COMPILER_LAUNCHER}
)
add_library(catch2 INTERFACE)
target_include_directories(catch2 INTERFACE ${CMAKE_BINARY_DIR}/catch2/include)
add_dependencies(catch2 catch2-ext)

set(MDBX_OUTPUT_DIR ${CMAKE_BINARY_DIR}/mdbx)
set(MDBX_BUILD_TIMESTAMP unknown)
add_subdirectory(../../external/libmdbx libmdbx)

add_library(triedent database.cpp ring_alloc.cpp)
target_include_directories(triedent PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/include ${Boost_INCLUDE_DIRS})
set_property(TARGET triedent PROPERTY CXX_STANDARD 20)

if (CMAKE_SYSTEM_PROCESSOR MATCHES "(x86_64)|(X86_64)|(amd64)|(AMD64)")
    target_compile_options(triedent PUBLIC -march=haswell -flto)
    target_link_options(triedent PUBLIC -march=haswell -flto)
endif()

add_executable(triedent-tests catch2 triedent-tests.cpp)
target_link_libraries(triedent-tests PUBLIC catch2 ${LINUX_LIBS} Threads::Threads triedent)
target_include_directories(triedent-tests PUBLIC ${Boost_INCLUDE_DIRS} ${CMAKE_CURRENT_SOURCE_DIR}/include ${CMAKE_CURRENT_SOURCE_DIR}/../psio/consthash/include)
set_property(TARGET triedent-tests PROPERTY CXX_STANDARD 20)

#add_executable(test t2.cpp)
#target_link_libraries(test PUBLIC ${LINUX_LIBS} Threads::Threads triedent)
#target_include_directories(test PUBLIC ${Boost_INCLUDE_DIRS} ${CMAKE_CURRENT_SOURCE_DIR}/include ${CMAKE_CURRENT_SOURCE_DIR}/../psio/consthash/include)
#set_property(TARGET test PROPERTY CXX_STANDARD 20)

add_executable(mermaid mermaid.cpp)
target_link_libraries(mermaid PUBLIC ${LINUX_LIBS} Threads::Threads Boost::program_options triedent)
target_include_directories(mermaid PUBLIC ${Boost_INCLUDE_DIRS} ${CMAKE_CURRENT_SOURCE_DIR}/include ${CMAKE_CURRENT_SOURCE_DIR}/../psio/consthash/include)
set_property(TARGET mermaid PROPERTY CXX_STANDARD 20)

add_executable(bigdb big.cpp)
target_link_libraries(bigdb PUBLIC ${LINUX_LIBS} Threads::Threads Boost::program_options triedent)
target_include_directories(bigdb PUBLIC ${Boost_INCLUDE_DIRS} ${CMAKE_CURRENT_SOURCE_DIR}/include ${CMAKE_CURRENT_SOURCE_DIR}/../psio/consthash/include)
set_property(TARGET bigdb PROPERTY CXX_STANDARD 20)

#add_executable(bankdb bank.cpp)
#target_link_libraries(bankdb PUBLIC ${LINUX_LIBS} Threads::Threads triedent)
#target_include_directories(bankdb PUBLIC ${Boost_INCLUDE_DIRS} ${CMAKE_CURRENT_SOURCE_DIR}/include ${CMAKE_CURRENT_SOURCE_DIR}/../psio/consthash/include)
#.set_property(TARGET bankdb PROPERTY CXX_STANDARD 20)
