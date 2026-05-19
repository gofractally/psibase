# CargoTools.cmake - Auto-install cargo-based tools into the build tree
#
# Provides: ensure_cargo_tool(NAME <name> VERSION <version> [BINARY <binary>])
#
# Tools are installed to ${CARGO_TOOLS_DIR}/bin/ (defaults to ${CMAKE_BINARY_DIR}/cargo-tools).
# Sets ${NAME}_EXECUTABLE in the parent scope, with hyphens replaced by underscores.

find_program(CARGO_EXECUTABLE cargo
    HINTS "$ENV{HOME}/.cargo/bin"
    REQUIRED
)

set(CARGO_TOOLS_DIR "${CMAKE_BINARY_DIR}/cargo-tools" CACHE PATH
    "Directory where cargo tools are installed")

function(ensure_cargo_tool)
    cmake_parse_arguments(ARG "" "NAME;VERSION;BINARY" "" ${ARGN})
    if(NOT ARG_BINARY)
        set(ARG_BINARY ${ARG_NAME})
    endif()

    set(TOOL_BIN "${CARGO_TOOLS_DIR}/bin/${ARG_BINARY}")
    set(STAMP_FILE "${CARGO_TOOLS_DIR}/.stamp-${ARG_NAME}-${ARG_VERSION}")

    if(NOT EXISTS "${STAMP_FILE}")
        message(STATUS "Installing ${ARG_NAME}@${ARG_VERSION} to ${CARGO_TOOLS_DIR}")
        execute_process(
            COMMAND ${CARGO_EXECUTABLE} install ${ARG_NAME}
                    --version =${ARG_VERSION}
                    --root ${CARGO_TOOLS_DIR}
            RESULT_VARIABLE RESULT
            OUTPUT_VARIABLE OUTPUT
            ERROR_VARIABLE  ERROR
        )
        if(NOT RESULT EQUAL 0)
            message(FATAL_ERROR "Failed to install ${ARG_NAME}@${ARG_VERSION}:\n${ERROR}")
        endif()
        file(WRITE "${STAMP_FILE}" "${ARG_VERSION}\n")
    endif()

    # Set EXECUTABLE variable with hyphens replaced by underscores
    string(REPLACE "-" "_" VAR_NAME "${ARG_NAME}")
    set(${VAR_NAME}_EXECUTABLE "${TOOL_BIN}" PARENT_SCOPE)
endfunction()
