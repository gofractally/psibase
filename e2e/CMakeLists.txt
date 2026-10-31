enable_testing()

get_filename_component(PSIBASE_BUILD_DIR "${CMAKE_CURRENT_BINARY_DIR}/.." ABSOLUTE)

add_test(
    NAME e2e-yarn-install
    COMMAND ${CMAKE_COMMAND} --build ${PSIBASE_BUILD_DIR} --target E2eYarnInstall
)
set_tests_properties(e2e-yarn-install PROPERTIES LABELS e2e)

# psibase_add_e2e_test(<name> <browser> [extra playwright args...])
# Registers one Playwright run (one browser project, optionally narrowed to
# a spec folder or file) as its own CTest entry labeled `e2e`.
function(psibase_add_e2e_test name browser)
    add_test(
        NAME ${name}
        COMMAND ${CMAKE_COMMAND} -E env
            PSINODE_BIN=${PSIBASE_BUILD_DIR}/psidk/bin/psinode
            PSIBASE_BIN=${PSIBASE_BUILD_DIR}/psidk/bin/psibase
            PSIBASE_PACKAGES=${PSIBASE_BUILD_DIR}/psidk/share/psibase/packages
            ${CMAKE_CURRENT_SOURCE_DIR}/run-ctest.sh ${browser} ${ARGN}
        WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}
    )
    set_tests_properties(
        ${name}
        PROPERTIES
            LABELS e2e
            SKIP_RETURN_CODE 77
            DEPENDS e2e-yarn-install
    )
endfunction()

psibase_add_e2e_test(e2e-chromium chromium)
psibase_add_e2e_test(e2e-webkit webkit)
