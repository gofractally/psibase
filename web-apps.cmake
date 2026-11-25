# The web UIs are built with Yarn's Plug'n'Play loader, which is tied to the Node
# release it runs under. Under Node 25 the pinned Yarn (4.18) gives ESLint a
# `require` without a cache and every UI build fails deep inside lint with
# "Cannot convert undefined or null to object". Say so here instead.
# .nvmrc names the supported release.
find_program(PSIBASE_NODE node)
if(PSIBASE_NODE)
    execute_process(COMMAND "${PSIBASE_NODE}" --version
        OUTPUT_VARIABLE psibase_node_version OUTPUT_STRIP_TRAILING_WHITESPACE ERROR_QUIET)
    string(REGEX MATCH "^v([0-9]+)" psibase_node_match "${psibase_node_version}")
    option(PSIBASE_ALLOW_UNTESTED_NODE "Build the web UIs with a Node release newer than the supported one" OFF)
    if(CMAKE_MATCH_1 AND CMAKE_MATCH_1 GREATER 24 AND NOT PSIBASE_ALLOW_UNTESTED_NODE)
        message(FATAL_ERROR
            "Node ${psibase_node_version} (${PSIBASE_NODE}) cannot build the web UIs: the pinned Yarn "
            "Plug'n'Play loader does not support it. Put Node 22 first on PATH (see .nvmrc; "
            "with Homebrew: PATH=\"$(brew --prefix node@22)/bin:$PATH\") and configure again, "
            "or pass -DPSIBASE_ALLOW_UNTESTED_NODE=ON to try anyway.")
    endif()
endif()

include(ExternalProject)

# Static (not built) resource dependencies
file(GLOB common-misc-resources LIST_DIRECTORIES false ${CMAKE_CURRENT_SOURCE_DIR}/packages/user/CommonApi/common/resources/*)

add_custom_target(YarnInstall
    COMMAND cd ${CMAKE_CURRENT_SOURCE_DIR}/packages && yarn --version && yarn
    COMMENT "Installing yarn dependencies"
    BUILD_ALWAYS 1
)

# Common library that other UIs depend on
ExternalProject_Add(CommonApiCommonLib_js
    SOURCE_DIR ${CMAKE_CURRENT_SOURCE_DIR}/packages/user/CommonApi/common/packages/common-lib
    DEPENDS YarnInstall
    BUILD_COMMAND cd ${CMAKE_CURRENT_SOURCE_DIR}/packages/user/CommonApi/common/packages/common-lib && yarn build
    CONFIGURE_COMMAND ""
    BUILD_BYPRODUCTS 
        ${CMAKE_CURRENT_SOURCE_DIR}/packages/user/CommonApi/common/packages/common-lib/dist
        ${CMAKE_CURRENT_SOURCE_DIR}/packages/user/CommonApi/common/packages/common-lib/dist/common-lib.js
        ${CMAKE_CURRENT_SOURCE_DIR}/packages/user/CommonApi/common/packages/common-lib/dist/common-lib.umd.cjs
        ${CMAKE_CURRENT_SOURCE_DIR}/packages/user/CommonApi/common/packages/common-lib/dist/index.d.ts
    INSTALL_COMMAND ""
    BUILD_ALWAYS 1
)

# Define all UI projects
set(UI_PROJECTS
    user/Host/LoginPrompt/ui:HostLoginPrompt_js
    user/Evaluations/ui:Evaluations_js
    user/Fractals/ui:Fractals_js
    user/FractalCore/ui:FractalCore_js
    user/TokenStream/ui:TokenStream_js
    user/CommonApi/common/packages/plugin-tester/ui:PluginTester_js
    user/Explorer/ui:Explorer_js
    user/Homepage/ui:Homepage_js
    user/Identity/ui:Identity_js
    user/Permissions/ui:Permissions_js
    user/Supervisor/ui:Supervisor_js
    user/Workshop/ui:Workshop_js
    user/Config/ui:Config_js
    local/XAdmin/ui:XAdmin_js
    local/XProxy/ui:XProxy_js
)

message(STATUS "common-misc-resources: ${common-misc-resources}")
# Create ExternalProject for each UI
foreach(UI ${UI_PROJECTS})
    string(REGEX REPLACE "^([^:]+):([^:]+)$" \\1 PATH ${UI})
    string(REGEX REPLACE "^([^:]+):([^:]+)$" \\2 TARGET_NAME ${UI})
    set(OUTPUT_FILEPATH ${CMAKE_CURRENT_SOURCE_DIR}/packages/${PATH}/dist/index.html)
    ExternalProject_Add(${TARGET_NAME}
        SOURCE_DIR ${CMAKE_CURRENT_SOURCE_DIR}/packages/${PATH}
        BUILD_COMMAND cd ${CMAKE_CURRENT_SOURCE_DIR}/packages/${PATH} && yarn build
        CONFIGURE_COMMAND ""
        BUILD_BYPRODUCTS ${OUTPUT_FILEPATH} ${CMAKE_CURRENT_SOURCE_DIR}/packages/${PATH}/dist
        DEPENDS CommonApiCommonLib_js YarnInstall
        INSTALL_COMMAND ""
        BUILD_ALWAYS 1
    )
    set(${TARGET_NAME}_DEP ${TARGET_NAME} ${OUTPUT_FILEPATH})
endforeach()
