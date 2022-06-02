function(add suffix)
    add_system_contract("${suffix}" AuthEcSys src/AuthEcSys.cpp)
endfunction(add)

conditional_add()
