function(add suffix)
    add_user_service("${suffix}" FractalSys src/FractalSys.cpp)
    add_user_service("${suffix}" CoreFractalSys src/CoreFractalSys.cpp)
endfunction(add)

conditional_add()

add_subdirectory(test)

set(CMAKE_EXPORT_COMPILE_COMMANDS on)
