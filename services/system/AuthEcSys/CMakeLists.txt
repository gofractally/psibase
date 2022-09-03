function(add suffix)
    add_system_service("${suffix}" AuthEcSys src/AuthEcSys.cpp)
    add_system_service("${suffix}" RAuthEcSys src/RAuthEcSys.cpp)
endfunction(add)

conditional_add()
