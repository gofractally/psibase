function(add suffix)
    add_system_contract("${suffix}" common_sys src/common_sys.cpp)
endfunction(add)

conditional_add()
