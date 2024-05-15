function(add suffix)
    add_system_service("${suffix}" AuthK1 src/AuthK1.cpp)
    add_system_service("${suffix}" RAuthK1 src/RAuthK1.cpp)
endfunction(add)

conditional_add()
