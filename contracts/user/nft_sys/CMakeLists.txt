function(add suffix)
    add_user_contract("${suffix}" nft_sys src/nft_sys.cpp)
endfunction(add)

add("")
add("-debug")

add_subdirectory(test)

set(CMAKE_EXPORT_COMPILE_COMMANDS on)