function(add suffix)
    add_system_contract("${suffix}" rpc_sys src/rpc_sys.cpp)
endfunction(add)

add("")
add("-debug")
