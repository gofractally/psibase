enable_testing()

function(add suffix)
    add_executable(psibase-tests${suffix} test.cpp test-sig.cpp test_event.cpp test_crypto.cpp test_memo.cpp test_clock.cpp test_semver.cpp test_subjective.cpp testKvMerkle.cpp test_rpc.cpp test_verify_services.cpp test_notify.cpp test_socket.cpp)
    target_include_directories(psibase-tests${suffix} PUBLIC ../include)
    target_compile_definitions(psibase-tests${suffix} PUBLIC -DCATCH_CONFIG_ENABLE_ALL_STRINGMAKERS=1)
    target_link_libraries(psibase-tests${suffix} services_system${suffix} services_user${suffix} psitestlib${suffix} catch2)
    set_target_properties(psibase-tests${suffix} PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${ROOT_BINARY_DIR})
endfunction(add)

if(DEFINED IS_WASM)
    conditional_add()
    add_wasm_test_release(psibase-tests)
    configure_file(semver.json ${ROOT_BINARY_DIR}/semver.json COPYONLY)
endif()

set(CMAKE_EXPORT_COMPILE_COMMANDS on)
