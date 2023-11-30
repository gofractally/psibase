function(add suffix)
    add_user_service("${suffix}" DocSys src/DocSys.cpp)
endfunction(add)

conditional_add()
