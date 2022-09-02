function(add_user_contract suffix name)
    add_executable(${name}${suffix} ${ARGN})
    target_include_directories(${name}${suffix} PUBLIC
        include
        ../CommonSys/include
        ../ExchangeSys/include
        ../NftSys/include
        ../PsiSpaceSys/include
        ../SymbolSys/include
        ../TokenSys/include
        ../../system/AccountSys/include
        ../../system/AuthEcSys/include
        ../../system/AuthAnySys/include
        ../../system/SetCodeSys/include
        ../../system/TransactionSys/include
        ../../system/VerifyEcSys/include
    )
    target_link_libraries(${name}${suffix} PUBLIC contracts_system${suffix} psibase-contract-simple-malloc${suffix})
    set_target_properties(${name}${suffix} PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${ROOT_BINARY_DIR})
endfunction(add_user_contract)

function(add_user_test suffix name)
    set(TARGET ${name}-test${suffix})
    add_executable(${TARGET} ${ARGN})
    target_include_directories(${TARGET} PUBLIC
      ../include
      ../../CommonSys/include
      ../../ExchangeSys/include
      ../../NftSys/include
      ../../PsiSpaceSys/include
      ../../SymbolSys/include
      ../../TokenSys/include
      ../../../system/AccountSys/include
      ../../../system/AuthEcSys/include
      ../../../system/AuthAnySys/include
      ../../../system/SetCodeSys/include
      ../../../system/TransactionSys/include
      ../../../system/VerifyEcSys/include
     ${CMAKE_CURRENT_LIST_DIR})
    target_link_libraries(${TARGET} contracts_system${suffix} psitestlib)
    set_target_properties(${TARGET} PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${ROOT_BINARY_DIR})
endfunction(add_user_test)

function(add_user_test_release name)
    if(BUILD_RELEASE_WASM)
        add_user_test("" ${name} ${ARGN})
    endif()
endfunction()

function(add_user_test_debug name)
    if(BUILD_DEBUG_WASM)
        add_user_test("-debug" ${name} ${ARGN})
    endif()
endfunction()

function(add suffix)
    add_library(contracts_user${suffix} INTERFACE)
    target_include_directories(contracts_user${suffix} INTERFACE
        NftSys/include
    )
endfunction(add)

add("")
add("-debug")

if(DEFINED IS_WASM)
    add_subdirectory(CommonSys)
    add_subdirectory(ExchangeSys)
    add_subdirectory(ExploreSys)
    add_subdirectory(launchTestChain)
    add_subdirectory(mincon)
    add_subdirectory(NftSys)
    add_subdirectory(PsiSpaceSys)
    add_subdirectory(SymbolSys)
    add_subdirectory(TokenSys)
endif()

set(CMAKE_EXPORT_COMPILE_COMMANDS on)
