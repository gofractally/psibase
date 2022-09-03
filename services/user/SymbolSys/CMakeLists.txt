function(add suffix)
    add_user_service("${suffix}" SymbolSys src/SymbolSys.cpp)
endfunction(add)

conditional_add()

add_subdirectory(test)

set(CMAKE_EXPORT_COMPILE_COMMANDS on)