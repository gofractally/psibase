function(add suffix)
    add_system_service("${suffix}" AuthDelegateSys src/AuthDelegateSys.cpp)
endfunction(add)

conditional_add()
