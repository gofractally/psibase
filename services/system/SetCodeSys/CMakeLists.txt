function(add suffix)
    add_system_service("${suffix}" SetCodeSys src/SetCodeSys.cpp)
endfunction(add)

conditional_add()
