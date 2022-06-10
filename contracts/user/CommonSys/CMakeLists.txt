function(add suffix)
    add_system_contract("${suffix}" CommonSys src/CommonSys.cpp)
endfunction(add)

conditional_add()
