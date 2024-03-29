enable_testing()

function(downloadThirdParty depName depUrl)
    ExternalProject_Add(
        ${depName}
        PREFIX ${CMAKE_CURRENT_SOURCE_DIR}/common/resources/thirdParty
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
    install(DIRECTORY system/Accounts/include/ TYPE INCLUDE FILES_MATCHING PATTERN "*.hpp")
    install(DIRECTORY system/AuthAny/include/ TYPE INCLUDE FILES_MATCHING PATTERN "*.hpp")
    install(DIRECTORY system/AuthK1/include/ TYPE INCLUDE FILES_MATCHING PATTERN "*.hpp")
    install(DIRECTORY system/AuthSig/include/ TYPE INCLUDE FILES_MATCHING PATTERN "*.hpp")
    install(DIRECTORY system/Producers/include/ TYPE INCLUDE FILES_MATCHING PATTERN "*.hpp")
    install(DIRECTORY system/HttpServer/include/ TYPE INCLUDE FILES_MATCHING PATTERN "*.hpp")
    install(DIRECTORY system/SetCode/include/ TYPE INCLUDE FILES_MATCHING PATTERN "*.hpp")
    install(DIRECTORY system/Transact/include/ TYPE INCLUDE FILES_MATCHING PATTERN "*.hpp")
    install(DIRECTORY system/VerifyK1/include/ TYPE INCLUDE FILES_MATCHING PATTERN "*.hpp")
    install(DIRECTORY user/CommonApi/include/ TYPE INCLUDE FILES_MATCHING PATTERN "*.hpp")
    install(DIRECTORY user/Explorer/include/ TYPE INCLUDE FILES_MATCHING PATTERN "*.hpp")
    install(DIRECTORY user/FractalSys/include/ TYPE INCLUDE FILES_MATCHING PATTERN "*.hpp")
    install(DIRECTORY user/NftSys/include/ TYPE INCLUDE FILES_MATCHING PATTERN "*.hpp")
    install(DIRECTORY user/PsiSpaceSys/include/ TYPE INCLUDE FILES_MATCHING PATTERN "*.hpp")
    install(DIRECTORY user/SymbolSys/include/ TYPE INCLUDE FILES_MATCHING PATTERN "*.hpp")
    install(DIRECTORY user/TokenSys/include/ TYPE INCLUDE FILES_MATCHING PATTERN "*.hpp")
endif()

set(CMAKE_EXPORT_COMPILE_COMMANDS on)
