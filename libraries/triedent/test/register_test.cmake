# The small correctness fixtures request GiB-sized pinned mappings per generated
# case. Do not repeatedly populate them on a generously configured Linux host.
# This affects this CTest child only, never the node or direct binary execution.
if(IS_NATIVE AND CMAKE_SYSTEM_NAME STREQUAL "Linux")
    find_package(Python3 COMPONENTS Interpreter REQUIRED)
    add_test(
        NAME n-triedent-tests
        WORKING_DIRECTORY "${ROOT_BINARY_DIR}"
        COMMAND "${Python3_EXECUTABLE}" "${CMAKE_CURRENT_LIST_DIR}/restricted_memlock.py"
                "$<TARGET_FILE:triedent-tests>"
    )
else()
    native_test(triedent-tests)
endif()
