function(add_system_contract suffix name)
    add_executable(${name}${suffix} ${ARGN})
    target_include_directories(${name}${suffix} PUBLIC include)
    target_link_libraries(${name}${suffix} PUBLIC contracts_system${suffix} psibase-contract-simple-malloc${suffix})
    set_target_properties(${name}${suffix} PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${ROOT_BINARY_DIR})
endfunction()

function(add suffix)
    add_library(contracts_system${suffix} INTERFACE)
    target_include_directories(contracts_system${suffix} INTERFACE
        account_sys/include
        auth_ec_sys/include
        auth_fake_sys/include
        rpc_account_sys/include
        rpc_sys/include
        test/include
        transaction_sys/include
        verify_ec_sys/include
    )
endfunction(add)

add("")
add("-debug")

if(DEFINED IS_WASM)
    add_subdirectory(account_sys)
    add_subdirectory(auth_ec_sys)
    add_subdirectory(auth_fake_sys)
    add_subdirectory(rpc_account_sys)
    add_subdirectory(rpc_sys)
    add_subdirectory(transaction_sys)
    add_subdirectory(verify_ec_sys)
endif()
