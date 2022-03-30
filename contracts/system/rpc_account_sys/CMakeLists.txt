function(add suffix)
    add_system_contract("${suffix}" rpc_account_sys src/rpc_account_sys.cpp)
endfunction(add)

add("")
add("-debug")
