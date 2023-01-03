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
add_custom_command(TARGET psinode POST_BUILD
    COMMAND mkdir -p ${ROOT_BINARY_DIR}/psidk/bin
    COMMAND cp -a $<TARGET_FILE:psinode> ${ROOT_BINARY_DIR}/psidk/bin
)
