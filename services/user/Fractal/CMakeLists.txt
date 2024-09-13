function(add suffix)
    add_user_service("${suffix}" Fractal src/Fractal.cpp)
    add_user_service("${suffix}" CoreFractal src/CoreFractal.cpp)

    target_link_libraries(Fractal${suffix} PUBLIC Spki${suffix})
endfunction(add)

conditional_add()

add_subdirectory(test)

set(CMAKE_EXPORT_COMPILE_COMMANDS on)
