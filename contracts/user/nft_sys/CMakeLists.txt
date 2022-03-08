function(add suffix)
    add_user_contract("${suffix}" nft_sys contract/src/account_sys.cpp)
endfunction(add)

add("")
add("-debug")

add_subdirectory(contract/test)