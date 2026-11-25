# Reassembles the psizam test fixtures and compares them with the checked-in
# modules. Run by the PsizamFixtureTests test.
file(MAKE_DIRECTORY "${WORK_DIR}")
foreach(fixture policy service)
    set(built "${WORK_DIR}/psizam-${fixture}.wasm")
    execute_process(
        COMMAND "${WAT2WASM}" "${SOURCE_DIR}/psizam-${fixture}.wat" -o "${built}"
        RESULT_VARIABLE result)
    if(NOT result EQUAL 0)
        message(FATAL_ERROR "wat2wasm failed on psizam-${fixture}.wat")
    endif()
    execute_process(
        COMMAND "${CMAKE_COMMAND}" -E compare_files "${built}" "${SOURCE_DIR}/psizam-${fixture}.wasm"
        RESULT_VARIABLE result)
    if(NOT result EQUAL 0)
        message(FATAL_ERROR
            "psizam-${fixture}.wasm does not match psizam-${fixture}.wat; reassemble it with "
            "wat2wasm psizam-${fixture}.wat -o psizam-${fixture}.wasm")
    endif()
endforeach()
