function(add suffix)
    add_system_contract("${suffix}" AccountSys src/AccountSys.cpp)
    add_system_contract("${suffix}" RAccountSys src/RAccountSys.cpp)
endfunction(add)

conditional_add()
