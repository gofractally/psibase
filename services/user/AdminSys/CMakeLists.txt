function(add suffix)
    add_user_service("${suffix}" AdminSys src/AdminSys.cpp)
endfunction(add)

conditional_add()
