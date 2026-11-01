function(add suffix)
    add_user_service_full_malloc("${suffix}" Explorer src/Explorer.cpp)
endfunction(add)

conditional_add()

add_subdirectory(test)
