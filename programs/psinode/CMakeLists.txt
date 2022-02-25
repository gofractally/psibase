add_executable(psinode main.cpp)
target_link_libraries(psinode newchain_http abieos debug_eos_vm)
target_include_directories(psinode PUBLIC
    ../../libraries/newchain/include/contract
    ../../contracts/newchain_tests)
set_target_properties(psinode PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${ROOT_BINARY_DIR})
add_custom_command(TARGET psinode POST_BUILD
    COMMAND mkdir -p ${ROOT_BINARY_DIR}/clsdk/bin
    COMMAND cp -a $<TARGET_FILE:psinode> ${ROOT_BINARY_DIR}/clsdk/bin
)
