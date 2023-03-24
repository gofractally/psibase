enable_testing()

function(service name suffix)
    add_executable(${name}${suffix} ${ARGN})
    target_include_directories(${name}${suffix} PUBLIC include)
    target_link_libraries(${name}${suffix} services_system${suffix} psibase-service-simple-malloc${suffix} )
    set_target_properties(${name}${suffix} PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${ROOT_BINARY_DIR})
endfunction()

function(add suffix)
    service(test-service "${suffix}" test-service.cpp)
    service(test_kv "${suffix}" test_kv.cpp)
    service(test_table "${suffix}" test_table.cpp)
    service(event-service "${suffix}" event-service.cpp)

    add_executable(psibase-tests${suffix} test.cpp test-ec.cpp test_event.cpp)
    target_include_directories(psibase-tests${suffix} PUBLIC include)
    target_link_libraries(psibase-tests${suffix} services_system${suffix} psitestlib${suffix} )
    set_target_properties(psibase-tests${suffix} PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${ROOT_BINARY_DIR})
endfunction(add)

if(DEFINED IS_WASM)
    conditional_add()
    add_wasm_test_release(psibase-tests)
endif()

set(CMAKE_EXPORT_COMPILE_COMMANDS on)
