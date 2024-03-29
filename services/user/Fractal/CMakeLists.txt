function(add suffix)
    add_user_service("${suffix}" Fractal src/Fractal.cpp)
    add_user_service("${suffix}" CoreFractal src/CoreFractal.cpp)
endfunction(add)

conditional_add()

add_subdirectory(test)

set(CMAKE_EXPORT_COMPILE_COMMANDS on)
