function(add suffix)
    add_system_contract("${suffix}" AuthFakeSys src/AuthFakeSys.cpp)
endfunction(add)

conditional_add()
