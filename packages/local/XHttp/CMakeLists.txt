function(add suffix)
    add_local_service_full_malloc("${suffix}" XHttp src/XHttp.cpp)
endfunction(add)

conditional_add()

install(DIRECTORY include/ TYPE INCLUDE FILES_MATCHING PATTERN "*.hpp")
