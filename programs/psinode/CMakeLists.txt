if(ENABLE_SSL)
    if (BUILD_STATIC)
        set(OPENSSL_USE_STATIC_LIBS TRUE)
    endif()
    find_package(OpenSSL REQUIRED SSL)
endif()

add_executable(psinode main.cpp)

target_link_libraries(psinode
    services_system
    psibase_http
    debug_eos_vm
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
    ../../services/psibase_tests)
set_target_properties(psinode PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${ROOT_BINARY_DIR})

find_package(Python COMPONENTS Interpreter)
if(Python_Interpreter_FOUND)
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
    add_test(
        NAME psinode_test_routing
        COMMAND ${Python_EXECUTABLE} test_routing.py --psinode=$<TARGET_FILE:psinode>
        WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}/tests)
    set_tests_properties(psinode_test_routing PROPERTIES PROCESSORS 7)
    add_test(
        NAME psinode_test_crash
        COMMAND ${Python_EXECUTABLE} test_crash.py --psinode=$<TARGET_FILE:psinode>
        WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}/tests)
    set_tests_properties(psinode_test_crash PROPERTIES PROCESSORS 4)
    add_test(
        NAME psinode_test_psibase
        COMMAND ${Python_EXECUTABLE} test_psibase.py --psinode=$<TARGET_FILE:psinode>
        WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}/tests)
    add_test(
        NAME psinode_test_subjective
        COMMAND ${Python_EXECUTABLE} test_subjective.py --psinode=$<TARGET_FILE:psinode>
        WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}/tests)
    set_tests_properties(psinode_test_subjective PROPERTIES PROCESSORS 4)
    add_test(
        NAME psinode_test_txqueue
        COMMAND ${Python_EXECUTABLE} test_txqueue.py --psinode=$<TARGET_FILE:psinode>
        WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}/tests)
    add_test(
        NAME psinode_test_query
        COMMAND ${Python_EXECUTABLE} test_query.py --psinode=$<TARGET_FILE:psinode>
        WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}/tests)
endif()

include(GNUInstallDirs)
install(FILES config.in DESTINATION ${CMAKE_INSTALL_DATADIR}/psibase COMPONENT ServerData)
install(TARGETS psinode RUNTIME COMPONENT ServerBin)
