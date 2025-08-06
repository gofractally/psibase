function(add suffix)
    add_system_service("${suffix}" Accounts src/Accounts.cpp)
    add_system_service("${suffix}" RAccounts src/RAccounts.cpp)
endfunction(add)

conditional_add()
