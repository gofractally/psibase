function(add suffix)
    add_system_contract("${suffix}" rpc_roothost_sys src/rpc_roothost_sys.cpp)
endfunction(add)

add("")
add("-debug")
