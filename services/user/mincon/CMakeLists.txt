function(add suffix)
    add_user_contract("${suffix}" mincon src/mincon.cpp)
endfunction(add)

conditional_add()

set(CMAKE_EXPORT_COMPILE_COMMANDS on)
