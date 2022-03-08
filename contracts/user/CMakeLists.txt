function(add_user_contract suffix name)
    add_executable(${name}${suffix} ${ARGN})
    target_include_directories(${name}${suffix} PUBLIC contract/include)
    target_link_libraries(${name}${suffix} PUBLIC contracts_user${suffix} psibase-contract-simple-malloc${suffix})
    set_target_properties(${name}${suffix} PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${ROOT_BINARY_DIR})
endfunction()

function(add_user_test suffix name)
    set(TARGET ${name}-test${suffix})
    add_executable(${TARGET} ${ARGN})
    target_include_directories(${TARGET} PUBLIC ../system/ ${CMAKE_CURRENT_LIST_DIR})
    target_link_libraries(${TARGET} contracts_system${suffix} nctestlib)
    set_target_properties(${TARGET} PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${ROOT_BINARY_DIR})
endfunction(add)

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
endif()
