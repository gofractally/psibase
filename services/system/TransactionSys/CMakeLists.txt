function(add suffix)
    add_system_service("${suffix}" TransactionSys src/TransactionSys.cpp)
endfunction(add)

conditional_add()
