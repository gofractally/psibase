enable_testing()

find_package(Threads REQUIRED)

add_library(triedent src/database.cpp src/ring_alloc.cpp src/mapping.cpp)
target_include_directories(triedent PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/include ${Boost_INCLUDE_DIRS})
target_link_libraries(triedent PUBLIC Threads::Threads)

if (CMAKE_SYSTEM_PROCESSOR MATCHES "(x86_64)|(X86_64)|(amd64)|(AMD64)")
   if( NOT APPLE )
    target_compile_options(triedent PUBLIC $<$<CONFIG:Release>:-march=haswell -flto>)
    target_link_options(triedent PUBLIC $<$<CONFIG:Release>:-march=haswell -flto>)
   else()
    target_compile_options(triedent PUBLIC $<$<CONFIG:Release>:-flto>)
    target_link_options(triedent PUBLIC $<$<CONFIG:Release>:-flto>)
   endif()
endif()

add_executable(mermaid src/mermaid.cpp)
target_link_libraries(mermaid PUBLIC Boost::program_options triedent)
target_include_directories(mermaid PUBLIC ${Boost_INCLUDE_DIRS} ${CMAKE_CURRENT_SOURCE_DIR}/include)
set_target_properties(mermaid PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${ROOT_BINARY_DIR})

add_subdirectory(test)
