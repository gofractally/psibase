function(add suffix)
    add_local_service("${suffix}" XDb src/XDb.cpp)
endfunction(add)

conditional_add()

install(DIRECTORY include/ TYPE INCLUDE FILES_MATCHING PATTERN "*.hpp")
