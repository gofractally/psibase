function(add suffix)
    add_user_contract("${suffix}" rpc_token_sys src/rpc_token_sys.cpp)
endfunction(add)

conditional_add()

set(CMAKE_EXPORT_COMPILE_COMMANDS on)
