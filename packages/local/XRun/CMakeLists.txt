function(add suffix)
    add_local_service("${suffix}" XRun src/XRun.cpp)
endfunction(add)

conditional_add()

install(DIRECTORY include/ TYPE INCLUDE FILES_MATCHING PATTERN "*.hpp")
