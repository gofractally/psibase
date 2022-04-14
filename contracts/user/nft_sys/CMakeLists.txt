function(add suffix)
    add_user_contract("${suffix}" nft_sys contract/src/nft_sys.cpp)
endfunction(add)

add("")
add("-debug")

add_subdirectory(contract/test)

set(CMAKE_EXPORT_COMPILE_COMMANDS on)