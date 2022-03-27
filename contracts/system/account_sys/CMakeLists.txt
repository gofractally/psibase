function(add suffix)
    add_system_contract("${suffix}" account_sys src/account_sys.cpp)
endfunction(add)

add("")
add("-debug")
