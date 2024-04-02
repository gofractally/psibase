function(add suffix)
    add_system_service("${suffix}" Transact src/Transact.cpp)
endfunction(add)

conditional_add()
