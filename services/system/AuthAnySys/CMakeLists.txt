function(add suffix)
    add_system_service("${suffix}" AuthAnySys src/AuthAnySys.cpp)
endfunction(add)

conditional_add()

set(CMAKE_EXPORT_COMPILE_COMMANDS on)
