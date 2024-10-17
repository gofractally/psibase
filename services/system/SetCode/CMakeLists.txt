function(add suffix)
    add_system_service("${suffix}" SetCode src/SetCode.cpp)
    add_system_service("${suffix}" RSetCode src/RSetCode.cpp)
endfunction(add)

conditional_add()
