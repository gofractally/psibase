function(add suffix)
    add_system_service("${suffix}" SetCode src/SetCode.cpp)
endfunction(add)

conditional_add()
