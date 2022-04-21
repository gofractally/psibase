function(add suffix)
    add_system_contract("${suffix}" auth_fake_sys src/auth_fake_sys.cpp)
endfunction(add)

conditional_add()
