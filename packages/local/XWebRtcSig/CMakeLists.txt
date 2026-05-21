# Native-build test registrations for the XWebRtcSig service.
#
# These are Python integration tests that drive the x-webrtcsig websocket
# protocol against a real psinode binary. They live next to the
# package they exercise so that adding/changing them does not require touching
# unrelated subtrees.

if(DEFINED IS_WASM)
    return()
endif()

find_package(Python COMPONENTS Interpreter)
if(NOT Python_Interpreter_FOUND)
    return()
endif()

set(_XWEBRTCSIG_TEST_DIR ${CMAKE_CURRENT_SOURCE_DIR}/tests/python)
set(_PSINODE_TEST_HELPERS ${CMAKE_SOURCE_DIR}/programs/psinode/tests)
set(_XWEBRTCSIG_PACKAGE_DIR ${ROOT_BINARY_DIR}/share/psibase/packages)

function(add_xwebrtcsig_test name)
    add_test(
        NAME xwebrtcsig_${name}
        COMMAND ${Python_EXECUTABLE} ${name}.py --psinode=$<TARGET_FILE:psinode> ${ARGN}
        WORKING_DIRECTORY ${_XWEBRTCSIG_TEST_DIR}
    )
    set_tests_properties(xwebrtcsig_${name} PROPERTIES
        ENVIRONMENT "PYTHONPATH=${_PSINODE_TEST_HELPERS}:$ENV{PYTHONPATH};PSIBASE_PACKAGE_DIR=${_XWEBRTCSIG_PACKAGE_DIR}"
    )
endfunction()

add_xwebrtcsig_test(test_xwebrtcsig)
