function(add suffix)
    add_system_contract("${suffix}" proxy_sys src/proxy_sys.cpp)
endfunction(add)

conditional_add()
