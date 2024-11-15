function(add suffix)
    add_system_service("${suffix}" Sites src/Sites.cpp)
endfunction(add)

conditional_add()
