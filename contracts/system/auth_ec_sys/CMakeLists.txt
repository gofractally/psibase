function(add suffix)
    add_system_contract("${suffix}" auth_ec_sys src/auth_ec_sys.cpp)
endfunction(add)

conditional_add()
