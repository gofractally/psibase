function(add suffix)
    add_user_service("${suffix}" mincon src/mincon.cpp)
endfunction(add)

conditional_add()

set(CMAKE_EXPORT_COMPILE_COMMANDS on)
