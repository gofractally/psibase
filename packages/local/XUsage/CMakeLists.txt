function(add suffix)
    add_local_service("${suffix}" XUsage src/XUsage.cpp)
endfunction(add)

conditional_add()

add_subdirectory(test)

install(DIRECTORY include/ TYPE INCLUDE FILES_MATCHING PATTERN "*.hpp")

set(CMAKE_EXPORT_COMPILE_COMMANDS on)
