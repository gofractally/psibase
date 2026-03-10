enable_testing()

function(add_sys_cargo_psibase_test name)
    add_test(
        NAME rs-test-${name}
        COMMAND ${CMAKE_BINARY_DIR}/../rust/release/cargo-psibase test --manifest-path ${CMAKE_CURRENT_SOURCE_DIR}/system/${name}/service/Cargo.toml --target-dir ${SYSTEM_WORKSPACE_TARGET} --psitest=${CMAKE_BINARY_DIR}/../psitest
    )
endfunction()

function(add_usr_cargo_psibase_test name)
    add_test(
        NAME rs-test-${name}
        COMMAND ${CMAKE_BINARY_DIR}/../rust/release/cargo-psibase test --manifest-path ${CMAKE_CURRENT_SOURCE_DIR}/user/${name}/service/Cargo.toml --target-dir ${USER_WORKSPACE_TARGET} --psitest=${CMAKE_BINARY_DIR}/../psitest
    )
endfunction()

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

add_subdirectory(local)
add_subdirectory(system)
add_subdirectory(user)
add_subdirectory(psibase_tests)

if(DEFINED IS_WASM)
    add_sys_cargo_psibase_test(StagedTx)
    add_sys_cargo_psibase_test(VirtualServer)

    add_usr_cargo_psibase_test(DiffAdjust)
    add_usr_cargo_psibase_test(Identity)
    add_usr_cargo_psibase_test(Registry)
    add_usr_cargo_psibase_test(Subgroups)
    add_usr_cargo_psibase_test(Tokens)
    add_usr_cargo_psibase_test(TokenStream)
endif()

if(DEFINED IS_WASM)
    install(DIRECTORY system/Accounts/include/ TYPE INCLUDE FILES_MATCHING PATTERN "*.hpp")
    install(DIRECTORY system/AuthAny/include/ TYPE INCLUDE FILES_MATCHING PATTERN "*.hpp")
    install(DIRECTORY system/AuthDelegate/include/ TYPE INCLUDE FILES_MATCHING PATTERN "*.hpp")
    install(DIRECTORY system/AuthSig/include/ TYPE INCLUDE FILES_MATCHING PATTERN "*.hpp")
    install(DIRECTORY system/Credentials/service/cpp/include/ TYPE INCLUDE FILES_MATCHING PATTERN "*.hpp")
    install(DIRECTORY system/HttpServer/include/ TYPE INCLUDE FILES_MATCHING PATTERN "*.hpp")
    install(DIRECTORY system/Producers/include/ TYPE INCLUDE FILES_MATCHING PATTERN "*.hpp")
    install(DIRECTORY system/SetCode/include/ TYPE INCLUDE FILES_MATCHING PATTERN "*.hpp")
    install(DIRECTORY system/StagedTx/service/cpp/include/ TYPE INCLUDE FILES_MATCHING PATTERN "*.hpp")
    install(DIRECTORY system/Transact/include/ TYPE INCLUDE FILES_MATCHING PATTERN "*.hpp")
    install(DIRECTORY system/VerifySig/include/ TYPE INCLUDE FILES_MATCHING PATTERN "*.hpp")
    install(DIRECTORY system/VirtualServer/service/cpp/include/ TYPE INCLUDE FILES_MATCHING PATTERN "*.hpp")
    
    install(DIRECTORY user/BrotliCodec/include/ TYPE INCLUDE FILES_MATCHING PATTERN "*.hpp")
    install(DIRECTORY user/CommonApi/include/ TYPE INCLUDE FILES_MATCHING PATTERN "*.hpp")
    install(DIRECTORY user/Events/include/ TYPE INCLUDE FILES_MATCHING PATTERN "*.hpp")
    install(DIRECTORY user/Explorer/include/ TYPE INCLUDE FILES_MATCHING PATTERN "*.hpp")
    install(DIRECTORY user/Identity/include/ TYPE INCLUDE FILES_MATCHING PATTERN "*.hpp")
    install(DIRECTORY user/Invite/include/ TYPE INCLUDE FILES_MATCHING PATTERN "*.hpp")
    install(DIRECTORY user/Nft/include/ TYPE INCLUDE FILES_MATCHING PATTERN "*.hpp")
    install(DIRECTORY user/Sites/include/ TYPE INCLUDE FILES_MATCHING PATTERN "*.hpp")
    install(DIRECTORY user/Symbol/include/ TYPE INCLUDE FILES_MATCHING PATTERN "*.hpp")
    install(DIRECTORY user/Tokens/include/ TYPE INCLUDE FILES_MATCHING PATTERN "*.hpp")
endif()

set(CMAKE_EXPORT_COMPILE_COMMANDS on)
