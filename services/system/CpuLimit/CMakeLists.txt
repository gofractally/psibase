function(add suffix)
    add_system_service("${suffix}" CpuLimit src/CpuLimit.cpp)
endfunction(add)

conditional_add()
