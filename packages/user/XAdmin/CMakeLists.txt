function(add suffix)
    add_user_service("${suffix}" XAdmin query/src/XAdmin.cpp)
endfunction(add)

conditional_add()

set(CMAKE_EXPORT_COMPILE_COMMANDS on)
