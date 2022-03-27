function(add suffix)
    add_user_contract("${suffix}" mincon src/mincon.cpp)
endfunction(add)

add("")
add("-debug")

set(CMAKE_EXPORT_COMPILE_COMMANDS on)
