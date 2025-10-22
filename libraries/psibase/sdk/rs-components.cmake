# A function that can be used to add a new target that builds a wasm component from rust
set(COMPONENT_BIN_DIR ${CMAKE_CURRENT_BINARY_DIR}/components)
function(add_rs_component TARGET_TUPLE OUTPUT_FILE TARGET_ARCH)
    cmake_parse_arguments(ARG "" "SHARED_TARGET_DIR" "" ${ARGN})

    string(REGEX REPLACE "^([^:]+):([^:]+)$" \\1 PATH ${TARGET_TUPLE})
    string(REGEX REPLACE "^([^:]+):([^:]+)$" \\2 TARGET_NAME ${TARGET_TUPLE})
    set(OUTPUT_FILEPATH ${COMPONENT_BIN_DIR}/${OUTPUT_FILE})

    if(ARG_SHARED_TARGET_DIR AND NOT ARG_SHARED_TARGET_DIR STREQUAL "false")
        set(TARGET_DIR ${CMAKE_CURRENT_BINARY_DIR}/plugins)
    else()
        set(TARGET_DIR ${CMAKE_CURRENT_BINARY_DIR}/plugins/${TARGET_NAME})
    endif()

    ExternalProject_Add(${TARGET_NAME}
        SOURCE_DIR ${CMAKE_CURRENT_SOURCE_DIR}/${PATH}
        BUILD_BYPRODUCTS ${OUTPUT_FILEPATH}
        CONFIGURE_COMMAND ""
        BUILD_COMMAND cargo component build -r
            --target ${TARGET_ARCH}
            --manifest-path ${CMAKE_CURRENT_SOURCE_DIR}/${PATH}/Cargo.toml 
            --target-dir    ${TARGET_DIR}
        COMMAND ${CMAKE_COMMAND} -E copy_if_different ${TARGET_DIR}/${TARGET_ARCH}/release/${OUTPUT_FILE} ${OUTPUT_FILEPATH}
        BUILD_ALWAYS 1
        INSTALL_COMMAND ""
    )

    # Expose `${TARGET_NAME}` and its dependency to the parent scope for further use
    set(${TARGET_NAME}_DEP ${TARGET_NAME} ${OUTPUT_FILEPATH} PARENT_SCOPE)
    set(${TARGET_NAME}_OUTPUT_FILE ${OUTPUT_FILE} PARENT_SCOPE)
endfunction()


# Parameters:
# TARGET_TUPLE: The target tuple includes the path and the target name. Example: "packages/:ServiceComponents"
# ARGN: All of the package names to build. If cargo.toml has `package.name = "my-package"`, then pass `my-package`
function(add_rs_component_workspace TARGET_TUPLE)
    string(REGEX REPLACE "^([^:]+):([^:]+)$" \\1 PATH ${TARGET_TUPLE})
    string(REGEX REPLACE "^([^:]+):([^:]+)$" \\2 TARGET_NAME ${TARGET_TUPLE})

    set(OUTPUT_FILEPATHS "")
    set(OUTPUT_FILES "")
    foreach(FILENAME ${ARGN})
        string(REGEX REPLACE "-" "_" FILENAME ${FILENAME})
        
        # Sets a veriable called {TARGET_NAME}_OUTPUT_FILE_{FILENAME} and expose it to the caller of this function
        # For example, for the package 'my-package', a variable called `Plugins_my_package_OUTPUT_FILE`
        set(${TARGET_NAME}_OUTPUT_FILE_${FILENAME} ${COMPONENT_BIN_DIR}/${FILENAME}.wasm PARENT_SCOPE)

        set(FILENAME ${FILENAME}.wasm)
        list(APPEND OUTPUT_FILEPATHS ${COMPONENT_BIN_DIR}/${FILENAME})
        list(APPEND OUTPUT_FILES ${FILENAME})
    endforeach()

    set(TARGET_DIR ${CMAKE_CURRENT_BINARY_DIR}/plugin_workspaces/${TARGET_NAME})
    set(TARGET_ARCH wasm32-wasip1)

    set(COPY_COMMANDS "")
    foreach(FILENAME ${OUTPUT_FILES})
        set(SOURCE_FILE ${TARGET_DIR}/${TARGET_ARCH}/release/${FILENAME})
        set(DEST_FILE ${COMPONENT_BIN_DIR}/${FILENAME})
        list(APPEND COPY_COMMANDS
            COMMAND ${CMAKE_COMMAND} -E copy_if_different ${SOURCE_FILE} ${DEST_FILE}
        )
    endforeach()

    ExternalProject_Add(${TARGET_NAME}
        SOURCE_DIR ${CMAKE_CURRENT_SOURCE_DIR}/${PATH}
        BUILD_BYPRODUCTS ${OUTPUT_FILEPATHS}
        CONFIGURE_COMMAND ""
        BUILD_COMMAND cargo component build -r
            --target ${TARGET_ARCH}
            --manifest-path ${CMAKE_CURRENT_SOURCE_DIR}/${PATH}/Cargo.toml 
            --target-dir    ${TARGET_DIR}
        ${COPY_COMMANDS}
        BUILD_ALWAYS 1
        INSTALL_COMMAND ""
    )

    # Expose the target name to the caller of this function
    set(${TARGET_NAME}_DEP ${TARGET_NAME} PARENT_SCOPE)
endfunction()
