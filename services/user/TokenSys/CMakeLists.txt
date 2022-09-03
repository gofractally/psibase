function(add suffix)
    add_user_service("${suffix}" TokenSys src/TokenSys.cpp)
    add_user_service("${suffix}" RTokenSys src/RTokenSys.cpp)
endfunction(add)

conditional_add()

add_subdirectory(test)

set(CMAKE_EXPORT_COMPILE_COMMANDS on)
