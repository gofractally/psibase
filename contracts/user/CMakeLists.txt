function(add_user_contract suffix name)
    add_executable(${name}${suffix} ${ARGN})
    target_include_directories(${name}${suffix} PUBLIC 
        contract/include
        include
        ../../system/account_sys/include
        ../../system/auth_ec_sys/include
        ../../system/auth_fake_sys/include
        ../../system/transaction_sys/include
        ../../system/verify_ec_sys/include
    )
    target_link_libraries(${name}${suffix} PUBLIC contracts_user${suffix} psibase-contract-simple-malloc${suffix})
    set_target_properties(${name}${suffix} PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${ROOT_BINARY_DIR})
endfunction(add_user_contract)

function(add_user_test suffix name)
    set(TARGET ${name}-test${suffix})
    add_executable(${TARGET} ${ARGN})
    target_include_directories(${TARGET} PUBLIC ../../../../system ../include ${CMAKE_CURRENT_LIST_DIR})
    target_link_libraries(${TARGET} contracts_system${suffix} nctestlib)
    set_target_properties(${TARGET} PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${ROOT_BINARY_DIR})
endfunction(add_user_test)

function(add suffix)
    add_library(contracts_user${suffix} INTERFACE)
    target_include_directories(contracts_user${suffix} INTERFACE
        nft_sys/contract/include
    )
endfunction(add)

add("")
add("-debug")

if(DEFINED IS_WASM)
    add_subdirectory(nft_sys)
    add_subdirectory(mincon)
endif()

set(CMAKE_EXPORT_COMPILE_COMMANDS on)
