function(add suffix)
    add_system_service("${suffix}" AuthNone src/AuthNone.cpp)
endfunction(add)

conditional_add()
