function(add suffix)
    add_system_contract("${suffix}" SetCodeSys src/SetCodeSys.cpp)
endfunction(add)

conditional_add()
