function(add suffix)
    add_system_service("${suffix}" GetUser GetUser.cpp)
endfunction(add)

if(DEFINED IS_WASM)
    conditional_add()
    add_system_test(Transact Transact-test.cpp)
endif()
