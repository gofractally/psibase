function(add suffix)
    add_system_contract("${suffix}" AuthAnySys src/AuthAnySys.cpp)
endfunction(add)

conditional_add()
