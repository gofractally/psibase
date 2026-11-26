function(add suffix)
    add_local_service("${suffix}" XUsage src/XUsage.cpp)
endfunction(add)

conditional_add()

install(DIRECTORY include/ TYPE INCLUDE FILES_MATCHING PATTERN "*.hpp")
