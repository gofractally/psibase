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

set(CMAKE_EXPORT_COMPILE_COMMANDS on)
