function(add suffix)
    add_user_contract("${suffix}" FractallySys src/FractallySys.cpp)
endfunction(add)

conditional_add()

add_subdirectory(test)

set(CMAKE_EXPORT_COMPILE_COMMANDS on)
