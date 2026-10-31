enable_testing()

get_filename_component(PSIBASE_BUILD_DIR "${CMAKE_CURRENT_BINARY_DIR}/.." ABSOLUTE)

add_test(
    NAME e2e-yarn-install
    COMMAND ${CMAKE_COMMAND} --build ${PSIBASE_BUILD_DIR} --target E2eYarnInstall
)
set_tests_properties(e2e-yarn-install PROPERTIES LABELS e2e)

add_test(
    NAME e2e
    COMMAND ${CMAKE_COMMAND} -E env
        PSINODE_BIN=${PSIBASE_BUILD_DIR}/psidk/bin/psinode
        PSIBASE_BIN=${PSIBASE_BUILD_DIR}/psidk/bin/psibase
        ${CMAKE_CURRENT_SOURCE_DIR}/run-ctest.sh
    WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}
)
set_tests_properties(
    e2e
    PROPERTIES
        LABELS e2e
        SKIP_RETURN_CODE 77
        DEPENDS e2e-yarn-install
)
