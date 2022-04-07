function(add_user_contract suffix name)
    add_executable(${name}${suffix} ${ARGN})
    target_include_directories(${name}${suffix} PUBLIC
        contract/include
        include
        ../common_sys/contract/include
        ../exchange_sys/contract/include
        ../name_sys/contract/include
        ../nft_sys/contract/include
        ../symbol_sys/contract/include
        ../tokens_sys/contract/include
        ../../system/account_sys/include
        ../../system/auth_ec_sys/include
        ../../system/auth_fake_sys/include
        ../../system/transaction_sys/include
        ../../system/verify_ec_sys/include
    )
    target_link_libraries(${name}${suffix} PUBLIC contracts_system${suffix} psibase-contract-simple-malloc${suffix})
    set_target_properties(${name}${suffix} PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${ROOT_BINARY_DIR})
endfunction(add_user_contract)

function(add_user_test suffix name)
    set(TARGET ${name}-test${suffix})
    add_executable(${TARGET} ${ARGN})
    target_include_directories(${TARGET} PUBLIC
      ../include
      ../../../name_sys/contract/include
      ../../../nft_sys/contract/include
      ../../../symbol_sys/contract/include
      ../../../tokens_sys/contract/include
      ../../../exchange_sys/contract/include
      ../../../../system/account_sys/include
      ../../../../system/auth_ec_sys/include
      ../../../../system/auth_fake_sys/include
      ../../../../system/transaction_sys/include
      ../../../../system/verify_ec_sys/include
     ${CMAKE_CURRENT_LIST_DIR})
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
    add_subdirectory(common_sys)
    add_subdirectory(exchange_sys)
    add_subdirectory(mincon)
    add_subdirectory(name_sys)
    add_subdirectory(nft_sys)
    add_subdirectory(symbol_sys)
    add_subdirectory(tokens_sys)
endif()

set(CMAKE_EXPORT_COMPILE_COMMANDS on)
