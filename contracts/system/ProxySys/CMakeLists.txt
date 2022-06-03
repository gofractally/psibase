function(add suffix)
    add_system_contract("${suffix}" ProxySys src/ProxySys.cpp)
    add_system_contract("${suffix}" RProxySys src/RProxySys.cpp)
endfunction(add)

conditional_add()
