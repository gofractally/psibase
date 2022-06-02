function(add suffix)
    add_system_contract("${suffix}" ProxySys src/ProxySys.cpp)
endfunction(add)

conditional_add()
