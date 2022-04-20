function(add suffix)
    add_system_contract("${suffix}" explore_sys src/explore_sys.cpp)
endfunction(add)

conditional_add()
