find_package(Boost 1.75 CONFIG REQUIRED COMPONENTS filesystem)

add_executable(psitest main.cpp)
target_include_directories(psitest PRIVATE "${CMAKE_SOURCE_DIR}/libraries/psibase/native/tests")

# The test module runs on wasmtime in every build, whichever engine the node
# (and so the services of a test chain) has: see main.cpp, test_module.
if(APPLE)
    target_link_libraries(psitest
        psibase
        psizam-wasmtime
        ${Boost_LIBRARIES}
    )
elseif(UNIX)
    target_link_libraries(psitest
        psibase
        psizam-wasmtime
        ${Boost_LIBRARIES}
        -static-libgcc
        -static-libstdc++
    )
endif()

target_link_directories(psitest PUBLIC ${ICU_LIBRARY_DIR} )

set_target_properties(psitest PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${ROOT_BINARY_DIR})

install(TARGETS psitest RUNTIME COMPONENT Tester)

configure_file(psitest-gdb.py ${ROOT_BINARY_DIR}/psitest-gdb.py COPYONLY)
configure_file(psibase.py ${ROOT_BINARY_DIR}/share/psibase/python/psibase.py COPYONLY)

include(GNUInstallDirs)
install(FILES ${CMAKE_CURRENT_SOURCE_DIR}/psitest-gdb.py DESTINATION ${CMAKE_INSTALL_DATADIR}/gdb/auto-load/${CMAKE_INSTALL_FULL_BINDIR} COMPONENT Tester)
install(FILES ${CMAKE_CURRENT_SOURCE_DIR}/psibase.py DESTINATION ${CMAKE_INSTALL_DATADIR}/psibase/python COMPONENT Tester)
# TODO: find out why this is necessary. Without this,
# psitest, when compiled with gcc, produces
# "longjmp causes uninitialized stack frame"
# when the --subst option is used.
# target_compile_options(psitest PRIVATE -D_FORTIFY_SOURCE=0)

# psitest itself. The modules are WebAssembly text, which the engine reads.
set(psitest_modules "${CMAKE_CURRENT_SOURCE_DIR}/tests")

# The engine the test module runs on. A build that put another engine here
# would change what every t-* and rs-* result means (gofractally/psibase#2231).
add_test(NAME psitest-engine COMMAND psitest --version)
set_tests_properties(psitest-engine PROPERTIES
    PASS_REGULAR_EXPRESSION "test module engine: wasmtime \\(")

add_test(NAME psitest-module-runs COMMAND psitest "${psitest_modules}/exit.wat")
set_tests_properties(psitest-module-runs PROPERTIES
    PASS_REGULAR_EXPRESSION "hello from the test module" TIMEOUT 60)

# A test module that never returns is stopped by --timeout, long before
# ctest's own limit, and the run fails.
add_test(NAME psitest-runaway-module-is-stopped
    COMMAND psitest --timeout 1 "${psitest_modules}/runaway.wat")
set_tests_properties(psitest-runaway-module-is-stopped PROPERTIES
    PASS_REGULAR_EXPRESSION "the test module was stopped: it ran longer than the 1 s"
    TIMEOUT 60)

add_test(NAME psitest-module-trap COMMAND psitest "${psitest_modules}/trap.wat")
set_tests_properties(psitest-module-trap PROPERTIES
    PASS_REGULAR_EXPRESSION "test module trapped: .*unreachable" TIMEOUT 60)

# No engine but wasmtime is tried.
add_test(NAME psitest-module-unknown-import
    COMMAND psitest "${psitest_modules}/unknown-import.wat")
set_tests_properties(psitest-module-unknown-import PROPERTIES
    PASS_REGULAR_EXPRESSION "test module failed on wasmtime: .*notATesterFunction" TIMEOUT 60)
