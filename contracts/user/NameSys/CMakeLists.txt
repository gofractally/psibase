function(add suffix)
    add_user_contract("${suffix}" NameSys src/NameSys.cpp)
endfunction(add)

conditional_add()

add_subdirectory(test)

set(CMAKE_EXPORT_COMPILE_COMMANDS on)