function(add suffix)
    add_system_service("${suffix}" AuthAny src/AuthAny.cpp)
endfunction(add)

conditional_add()
