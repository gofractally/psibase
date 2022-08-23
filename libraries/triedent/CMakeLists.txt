enable_testing()

find_package(Threads REQUIRED)

add_library(triedent database.cpp ring_alloc.cpp)
target_include_directories(triedent PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/include ${Boost_INCLUDE_DIRS})
target_link_libraries(triedent PUBLIC Threads::Threads)

if (CMAKE_SYSTEM_PROCESSOR MATCHES "(x86_64)|(X86_64)|(amd64)|(AMD64)")
   if( NOT APPLE )
    target_compile_options(triedent PUBLIC -march=haswell -flto)
    target_link_options(triedent PUBLIC -march=haswell -flto)
   else()
    target_compile_options(triedent PUBLIC -flto)
    target_link_options(triedent PUBLIC -flto)
   endif()
endif()

add_executable(triedent-tests triedent-tests.cpp)
target_link_libraries(triedent-tests PUBLIC catch2 triedent)
target_include_directories(triedent-tests PUBLIC ${Boost_INCLUDE_DIRS} ${CMAKE_CURRENT_SOURCE_DIR}/include ${CMAKE_CURRENT_SOURCE_DIR}/../psio/consthash/include)
set_target_properties(triedent-tests PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${ROOT_BINARY_DIR})
native_test(triedent-tests)

add_executable(mermaid mermaid.cpp)
target_link_libraries(mermaid PUBLIC Boost::program_options triedent)
target_include_directories(mermaid PUBLIC ${Boost_INCLUDE_DIRS} ${CMAKE_CURRENT_SOURCE_DIR}/include ${CMAKE_CURRENT_SOURCE_DIR}/../psio/consthash/include)
set_target_properties(mermaid PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${ROOT_BINARY_DIR})

add_executable(triedent-tests-bigdb big.cpp)
target_link_libraries(triedent-tests-bigdb PUBLIC Boost::program_options triedent)
target_include_directories(triedent-tests-bigdb PUBLIC ${Boost_INCLUDE_DIRS} ${CMAKE_CURRENT_SOURCE_DIR}/include ${CMAKE_CURRENT_SOURCE_DIR}/../psio/consthash/include)
set_target_properties(triedent-tests-bigdb PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${ROOT_BINARY_DIR})
