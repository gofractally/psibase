function(add suffix)
    add_system_service("${suffix}" AuthEc src/AuthEc.cpp)
    add_system_service("${suffix}" RAuthEc src/RAuthEc.cpp)
endfunction(add)

conditional_add()
