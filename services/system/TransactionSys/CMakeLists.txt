function(add suffix)
    add_system_contract("${suffix}" TransactionSys src/TransactionSys.cpp)
endfunction(add)

conditional_add()
