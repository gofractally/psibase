function(add suffix)
    add_system_service("${suffix}" TransactionQueue src/TransactionQueue.cpp)
endfunction(add)

conditional_add()
