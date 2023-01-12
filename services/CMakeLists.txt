enable_testing()

function(downloadThirdParty depName depUrl)
    ExternalProject_Add(
        ${depName}
        PREFIX ${CMAKE_CURRENT_SOURCE_DIR}/common/thirdParty
        URL ${depUrl}
        DOWNLOAD_NO_EXTRACT 1
        CONFIGURE_COMMAND ""
        BUILD_COMMAND ""
        INSTALL_COMMAND ""
        )
endfunction(downloadThirdParty)

add_subdirectory(system)
add_subdirectory(user)
add_subdirectory(psibase_tests)

if(DEFINED IS_WASM)
    install(DIRECTORY system/AccountSys/include/ TYPE INCLUDE FILES_MATCHING PATTERN "*.hpp")
    install(DIRECTORY system/AuthAnySys/include/ TYPE INCLUDE FILES_MATCHING PATTERN "*.hpp")
    install(DIRECTORY system/AuthEcSys/include/ TYPE INCLUDE FILES_MATCHING PATTERN "*.hpp")
    install(DIRECTORY system/ProducerSys/include/ TYPE INCLUDE FILES_MATCHING PATTERN "*.hpp")
    install(DIRECTORY system/ProxySys/include/ TYPE INCLUDE FILES_MATCHING PATTERN "*.hpp")
    install(DIRECTORY system/SetCodeSys/include/ TYPE INCLUDE FILES_MATCHING PATTERN "*.hpp")
    install(DIRECTORY system/TransactionSys/include/ TYPE INCLUDE FILES_MATCHING PATTERN "*.hpp")
    install(DIRECTORY system/VerifyEcSys/include/ TYPE INCLUDE FILES_MATCHING PATTERN "*.hpp")
    install(DIRECTORY user/CommonSys/include/ TYPE INCLUDE FILES_MATCHING PATTERN "*.hpp")
    install(DIRECTORY user/ExploreSys/include/ TYPE INCLUDE FILES_MATCHING PATTERN "*.hpp")
    install(DIRECTORY user/NftSys/include/ TYPE INCLUDE FILES_MATCHING PATTERN "*.hpp")
    install(DIRECTORY user/PsiSpaceSys/include/ TYPE INCLUDE FILES_MATCHING PATTERN "*.hpp")
    install(DIRECTORY user/SymbolSys/include/ TYPE INCLUDE FILES_MATCHING PATTERN "*.hpp")
    install(DIRECTORY user/TokenSys/include/ TYPE INCLUDE FILES_MATCHING PATTERN "*.hpp")
endif()

set(CMAKE_EXPORT_COMPILE_COMMANDS on)
