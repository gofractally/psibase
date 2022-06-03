function(add suffix)
    add_system_contract("${suffix}" AuthEcSys src/AuthEcSys.cpp)
    add_system_contract("${suffix}" RAuthEcSys src/RAuthEcSys.cpp)
endfunction(add)

conditional_add()
