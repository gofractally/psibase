function(add suffix)
    add_system_service("${suffix}" AuthDelegate src/AuthDelegate.cpp)
endfunction(add)

conditional_add()
