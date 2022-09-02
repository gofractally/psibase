function(add suffix)
    add_system_service("${suffix}" AccountSys src/AccountSys.cpp)
    add_system_service("${suffix}" RAccountSys src/RAccountSys.cpp)
endfunction(add)

conditional_add()
