add_executable(psinode main.cpp)
target_link_libraries(psinode
    contracts_system
    psibase_http
    debug_eos_vm
)
target_include_directories(psinode PUBLIC
    ../../libraries/psibase/contract/include
    ../../contracts/psibase_tests)
set_target_properties(psinode PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${ROOT_BINARY_DIR})
add_custom_command(TARGET psinode POST_BUILD
    COMMAND mkdir -p ${ROOT_BINARY_DIR}/psidk/bin
    COMMAND cp -a $<TARGET_FILE:psinode> ${ROOT_BINARY_DIR}/psidk/bin
)
