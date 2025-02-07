enable_testing()

find_package(Threads REQUIRED)

#set(compile_flags -coverage)
#set(link_flags -coverage)
add_library(arbtrie
    src/node_handle.cpp
    src/database.cpp
    src/mapping.cpp
    src/seg_allocator.cpp
    src/id_alloc.cpp
    src/recover.cpp
            )

target_include_directories(arbtrie PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/include ${Boost_INCLUDE_DIRS})
target_link_libraries(arbtrie PUBLIC Threads::Threads)
#target_compile_options(arbtrie PUBLIC -fsanitize=thread -g)
#target_link_options(arbtrie PUBLIC -fsanitize=thread -g)

if (CMAKE_SYSTEM_PROCESSOR MATCHES "(x86_64)|(X86_64)|(amd64)|(AMD64)")
   if( NOT APPLE )
    target_compile_options(arbtrie PUBLIC $<$<CONFIG:Release>:-march=haswell -flto>)
    target_link_options(arbtrie PUBLIC $<$<CONFIG:Release>:-march=haswell -flto>)
   else()
    target_compile_options(arbtrie PUBLIC $<$<CONFIG:Release>:-flto>)
    target_link_options(arbtrie PUBLIC $<$<CONFIG:Release>:-flto>)
   endif()
endif()


add_subdirectory(programs)
add_subdirectory(test)
