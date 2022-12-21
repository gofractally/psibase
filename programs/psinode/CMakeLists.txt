find_package(OpenSSL REQUIRED SSL)

add_executable(psinode main.cpp)

if(APPLE)
    target_link_libraries(psinode
        services_system
        psibase_http
        debug_eos_vm
        psibase_net
    )
elseif(UNIX)
  target_link_libraries(psinode
        OpenSSL::SSL
        services_system
        psibase_http
        debug_eos_vm
        psibase_net
        -static-libgcc
        -static-libstdc++
    )
endif()

target_include_directories(psinode PUBLIC
    ../../libraries/psibase/service/include
    ../../services/psibase_tests)
set_target_properties(psinode PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${ROOT_BINARY_DIR})
add_custom_command(TARGET psinode POST_BUILD
    COMMAND mkdir -p ${ROOT_BINARY_DIR}/psidk/bin
    COMMAND cp -a $<TARGET_FILE:psinode> ${ROOT_BINARY_DIR}/psidk/bin
)
