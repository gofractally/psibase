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

function(copy_service_headers category service)
    copy_headers(
        ${category}/${service}/include/services/${category}
        services/${category}/${service}/include/services/${category}
    )
endfunction()

if(DEFINED IS_WASM)
    copy_service_headers(system AccountSys)
    copy_service_headers(system AuthAnySys)
    copy_service_headers(system AuthEcSys)
    copy_service_headers(system ProducerSys)
    copy_service_headers(system ProxySys)
    copy_service_headers(system SetCodeSys)
    copy_service_headers(system TransactionSys)
    copy_service_headers(system VerifyEcSys)
    copy_service_headers(user CommonSys)
    copy_service_headers(user ExploreSys)
    copy_service_headers(user NftSys)
    copy_service_headers(user PsiSpaceSys)
    copy_service_headers(user SymbolSys)
    copy_service_headers(user TokenSys)
endif()

set(CMAKE_EXPORT_COMPILE_COMMANDS on)
