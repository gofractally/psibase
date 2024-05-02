function(add suffix)
    add_user_service("${suffix}" Tokens src/Tokens.cpp)
    add_user_service("${suffix}" RTokens src/RTokens.cpp)
endfunction(add)

conditional_add()

add_subdirectory(test)

set(CMAKE_EXPORT_COMPILE_COMMANDS on)
