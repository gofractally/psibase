function(add suffix)
    add_system_service("${suffix}" AuthDelegate src/AuthDelegate.cpp)
    add_system_service("${suffix}" RAuthDelegate src/RAuthDelegate.cpp)
endfunction(add)

add_subdirectory(test)

conditional_add()
