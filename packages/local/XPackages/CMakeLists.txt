function(add suffix)
    add_local_service("${suffix}" XPackages src/XPackages.cpp)
endfunction(add)

conditional_add()

add_subdirectory(test)

install(DIRECTORY include/ TYPE INCLUDE FILES_MATCHING PATTERN "*.hpp")

set(CMAKE_EXPORT_COMPILE_COMMANDS on)
