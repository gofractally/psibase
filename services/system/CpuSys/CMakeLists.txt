function(add suffix)
    add_system_service("${suffix}" CpuSys src/CpuSys.cpp)
endfunction(add)

conditional_add()
