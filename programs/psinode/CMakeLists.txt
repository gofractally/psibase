if(ENABLE_SSL)
    if (BUILD_STATIC)
        set(OPENSSL_USE_STATIC_LIBS TRUE)
    endif()
    find_package(OpenSSL REQUIRED SSL)
endif()

add_executable(psinode main.cpp init.cpp)

target_link_libraries(psinode
    services_system
    psibase_http
    psibase_net
)
target_link_directories( psinode PUBLIC ${ICU_LIBRARY_DIR} )

if(ENABLE_SSL)
    target_compile_definitions(psinode PUBLIC PSIBASE_ENABLE_SSL)
    target_link_libraries(psinode OpenSSL::SSL)
endif()

if(BUILD_STATIC AND UNIX AND NOT APPLE)
    target_link_libraries(psinode -static-libgcc -static-libstdc++)
endif()

target_include_directories(psinode PUBLIC
    ../../libraries/psibase/service/include
    ../../packages/psibase_tests)
set_target_properties(psinode PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${ROOT_BINARY_DIR})

find_package(Python COMPONENTS Interpreter)
if(Python_Interpreter_FOUND)
    # These tests would otherwise fail one by one with ModuleNotFoundError.
    execute_process(
        COMMAND ${Python_EXECUTABLE} -c "import requests, urllib3, websockets, cryptography"
        RESULT_VARIABLE psinode_test_modules_missing OUTPUT_QUIET ERROR_VARIABLE psinode_test_modules_error)
    if(psinode_test_modules_missing)
        string(REGEX MATCH "No module named '[^']+'" psinode_test_module "${psinode_test_modules_error}")
        message(WARNING
            "The psinode tests will fail: ${Python_EXECUTABLE} is missing Python modules "
            "(${psinode_test_module}). Install them with\n"
            "  ${Python_EXECUTABLE} -m pip install -r ${CMAKE_CURRENT_SOURCE_DIR}/tests/requirements.txt\n"
            "or configure with -DPython_EXECUTABLE=<a python that has them>.")
    endif()
    if(NOT LIBSOFTHSM2)
        find_library(LIBSOFTHSM2 libsofthsm2.so PATH_SUFFIXES softhsm)
    endif()
    find_program(SOFTHSM2_UTIL softhsm2-util)
    if(NOT LIBSOFTHSM2 OR NOT SOFTHSM2_UTIL)
        message(WARNING
            "SoftHSM 2 was not found (softhsm2-util and libsofthsm2.so): the psinode tests that "
            "sign with a hardware key (test_crash, test_psibase) will fail.")
    endif()
    find_library(LIBSOFTHSM2 libsofthsm2.so PATH_SUFFIXES softhsm)
    if(LIBSOFTHSM2)
        set(LIBSOFTHSM2_ARG --libsofthsm2=${LIBSOFTHSM2})
    else()
        set(LIBSOFTHSM2_ARG)
    endif()
    function(add_psinode_test name)
        add_test(
            NAME psinode_${name}
            COMMAND ${Python_EXECUTABLE} ${name}.py --psinode=$<TARGET_FILE:psinode> ${ARGN}
            WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}/tests)
    endfunction()
    add_test(
        NAME py_test_fracpack
        COMMAND ${Python_EXECUTABLE} test_fracpack.py
        WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}/tests)
    add_test(
        NAME py_test_name
        COMMAND ${Python_EXECUTABLE} test_name.py
        WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}/tests)
    add_test(
        NAME py_test_psibase_types
        COMMAND ${Python_EXECUTABLE} test_psibase_types.py
        WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}/tests)
    add_psinode_test(test_connect)
    add_psinode_test(test_routing)
    set_tests_properties(psinode_test_routing PROPERTIES PROCESSORS 7)
    add_psinode_test(test_crash ${LIBSOFTHSM2_ARG})
    set_tests_properties(psinode_test_crash PROPERTIES PROCESSORS 4)
    add_psinode_test(test_psibase ${LIBSOFTHSM2_ARG})
    add_psinode_test(test_subjective)
    set_tests_properties(psinode_test_subjective PROPERTIES PROCESSORS 4)
    add_psinode_test(test_txqueue)
    add_psinode_test(test_query)
    add_psinode_test(test_sites)
    add_psinode_test(test_shutdown)
    add_psinode_test(test_snapshot)
    set_tests_properties(psinode_test_snapshot PROPERTIES PROCESSORS 4)
    add_psinode_test(test_block_signing)
    set_tests_properties(psinode_test_block_signing PROPERTIES PROCESSORS 4)
    add_psinode_test(test_config)
    add_psinode_test(test_fetch)
    add_psinode_test(test_websocket)
    add_psinode_test(test_timer)
endif()

configure_file(config.in ${ROOT_BINARY_DIR}/share/psibase/config.in COPYONLY)

include(GNUInstallDirs)
install(FILES config.in DESTINATION ${CMAKE_INSTALL_DATADIR}/psibase COMPONENT ServerData)
install(TARGETS psinode RUNTIME COMPONENT ServerBin)
