function(add suffix)
    add_executable(generate_verify_with_call${suffix} generate_verify_with_call.cpp)
    target_link_libraries(generate_verify_with_call${suffix} services_system${suffix} services_user${suffix} services_test psitestlib${suffix})
    set_target_properties(generate_verify_with_call${suffix} PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${ROOT_BINARY_DIR})
endfunction(add)

if(DEFINED IS_WASM)
    conditional_add()
endif()

set(CMAKE_EXPORT_COMPILE_COMMANDS on)
