function(add suffix)
    add_user_contract("${suffix}" FractalGovSys src/FractalGovSys.cpp)
endfunction(add)

conditional_add()

set(CMAKE_EXPORT_COMPILE_COMMANDS on)
