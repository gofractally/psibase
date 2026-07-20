function(add suffix)
    add_local_service("${suffix}" XPeers src/XPeers.cpp)
endfunction(add)

conditional_add()

install(DIRECTORY include/ TYPE INCLUDE FILES_MATCHING PATTERN "*.hpp")

set(CMAKE_EXPORT_COMPILE_COMMANDS on)
