function(add suffix)
    add_system_service("${suffix}" ProxySys src/ProxySys.cpp)
    add_system_service("${suffix}" RProxySys src/RProxySys.cpp)
endfunction(add)

conditional_add()
