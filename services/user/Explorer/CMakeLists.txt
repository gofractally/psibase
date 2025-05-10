function(add suffix)
    add_user_service("${suffix}" Explorer src/Explorer.cpp)
endfunction(add)

conditional_add()
