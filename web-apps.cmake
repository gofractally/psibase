include(ExternalProject)

# Static (not built) resource dependencies
file(GLOB common-misc-resources LIST_DIRECTORIES false ${CMAKE_CURRENT_SOURCE_DIR}/services/user/CommonApi/common/resources/*)
file(GLOB common-fonts LIST_DIRECTORIES false ${CMAKE_CURRENT_SOURCE_DIR}/services/user/CommonApi/common/resources/fonts/*)

add_custom_target(YarnInstall
    COMMAND cd ${CMAKE_CURRENT_SOURCE_DIR}/services && yarn --version && yarn #&& yarn install-dev-tools
    COMMENT "Installing yarn dependencies"
    BUILD_ALWAYS 1
)

# Common library that other UIs depend on
ExternalProject_Add(CommonApiCommonLib_js
    SOURCE_DIR ${CMAKE_CURRENT_SOURCE_DIR}/services/user/CommonApi/common/packages/common-lib
    DEPENDS YarnInstall
    BUILD_COMMAND cd ${CMAKE_CURRENT_SOURCE_DIR}/services/user/CommonApi/common/packages/common-lib && yarn build
    CONFIGURE_COMMAND ""
    BUILD_BYPRODUCTS 
        ${CMAKE_CURRENT_SOURCE_DIR}/services/user/CommonApi/common/packages/common-lib/dist/common-lib.js
        ${CMAKE_CURRENT_SOURCE_DIR}/services/user/CommonApi/common/packages/common-lib/dist/common-lib.umd.cjs
        ${CMAKE_CURRENT_SOURCE_DIR}/services/user/CommonApi/common/packages/common-lib/dist/index.d.ts
    INSTALL_COMMAND ""
    BUILD_ALWAYS 1
)

# Define all UI projects
set(UI_PROJECTS
    system/Accounts/ui:Accounts_js
    system/AuthSig/ui:AuthSig_js
    system/Producers/ui:Producers_js
    user/Branding/ui:Branding_js
    user/CommonApi/common/packages/plugin-tester/ui:PluginTester_js
    user/Explorer/ui:Explorer_js
    user/Homepage/ui:Homepage_js
    user/Identity/ui:Identity_js
    # TODO: ask about empty Invite ui?
    # user/Invite/ui:Invite_js
    user/Permissions/ui:Permissions_js
    user/Supervisor/ui:Supervisor_js
    user/Workshop/ui:Workshop_js
    user/XAdmin/ui:XAdmin_js
)

# Create ExternalProject for each UI
foreach(UI ${UI_PROJECTS})
    string(REGEX REPLACE "^([^:]+):([^:]+)$" \\1 PATH ${UI})
    string(REGEX REPLACE "^([^:]+):([^:]+)$" \\2 TARGET_NAME ${UI})
    set(OUTPUT_FILEPATH ${CMAKE_CURRENT_SOURCE_DIR}/services/${PATH}/dist/index.html)
    ExternalProject_Add(${TARGET_NAME}
        SOURCE_DIR ${CMAKE_CURRENT_SOURCE_DIR}/services/${PATH}
        BUILD_COMMAND cd ${CMAKE_CURRENT_SOURCE_DIR}/services/${PATH} && yarn build
        CONFIGURE_COMMAND ""
        BUILD_BYPRODUCTS ${OUTPUT_FILEPATH}
        # TODO: does yarn build fail if these common- dir/files don't exist? If so, we don't need this DEPENDS
        # ${common-misc-resources} ${common-fonts}
        DEPENDS CommonApiCommonLib_js YarnInstall
        INSTALL_COMMAND ""
        BUILD_ALWAYS 1
    )
    set(${TARGET_NAME}_DEP ${TARGET_NAME} ${OUTPUT_FILEPATH})
endforeach()

# Special handling for XAdmin which has additional dependencies
# add_dependencies(xadmin_js XAdminWasm)