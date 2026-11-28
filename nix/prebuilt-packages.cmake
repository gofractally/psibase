# Stand-ins for what the root CMakeLists.txt builds when PSIBASE_PREBUILT_PACKAGES is on.
if(NOT PSIBASE_PLUGIN_DIR)
    message(FATAL_ERROR "PSIBASE_PREBUILT_PACKAGES requires -DPSIBASE_PLUGIN_DIR")
endif()
if(NOT PSIBASE_CARGO_PACKAGES)
    message(FATAL_ERROR "PSIBASE_PREBUILT_PACKAGES requires -DPSIBASE_CARGO_PACKAGES")
endif()

add_custom_target(wasm)
add_custom_target(doc)
add_custom_target(component-parser-prebuilt)
add_custom_target(CommonApiCommonLib_js)
add_custom_target(reserved-names)

set(ComponentParser_DEP component-parser-prebuilt)
set(COMPONENT_BIN_DIR ${PSIBASE_PLUGIN_DIR})
set(ComponentParser_OUTPUT_FILE component_parser.wasm)

# Mirrors the variables set by add_rs_component_workspace in rs-components.cmake
function(add_rs_component_workspace TARGET_TUPLE)
    string(REGEX REPLACE "^([^:]+):([^:]+)$" \\2 TARGET_NAME ${TARGET_TUPLE})
    foreach(FILENAME ${ARGN})
        string(REPLACE "-" "_" FILENAME ${FILENAME})
        set(${TARGET_NAME}_OUTPUT_FILE_${FILENAME} ${COMPONENT_BIN_DIR}/${FILENAME}.wasm PARENT_SCOPE)
    endforeach()
    add_custom_target(${TARGET_NAME})
    set(${TARGET_NAME}_DEP ${TARGET_NAME} PARENT_SCOPE)
endfunction()
