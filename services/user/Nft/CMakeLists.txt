function(add suffix)
    add_user_service("${suffix}" Nft src/Nft.cpp)
endfunction(add)

conditional_add()

add_subdirectory(test)

set(CMAKE_EXPORT_COMPILE_COMMANDS on)