function(add suffix)
    add_system_contract("${suffix}" ProducerSys src/ProducerSys.cpp)
endfunction(add)

conditional_add()
