enable_testing()

function(contract name suffix)
    add_executable(${name}${suffix} ${ARGN})
    target_include_directories(${name}${suffix} PUBLIC include)
    target_link_libraries(${name}${suffix} contracts_system${suffix} psibase-contract-simple-malloc )
    set_target_properties(${name}${suffix} PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${ROOT_BINARY_DIR})
endfunction()

function(add suffix)
    contract(test-cntr "${suffix}" test-cntr.cpp)
    contract(test_kv "${suffix}" test_kv.cpp)
    contract(test_table "${suffix}" test_table.cpp)

    add_executable(psibase-tests${suffix} test.cpp test-ec.cpp)
    target_include_directories(psibase-tests${suffix} PUBLIC include)
    target_link_libraries(psibase-tests${suffix} contracts_system${suffix} nctestlib )
    set_target_properties(psibase-tests${suffix} PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${ROOT_BINARY_DIR})
endfunction(add)

if(DEFINED IS_WASM)
    conditional_add()
    add_wasm_test_release(psibase-tests)
endif()

set(CMAKE_EXPORT_COMPILE_COMMANDS on)
