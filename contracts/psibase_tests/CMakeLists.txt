function(add suffix)
    add_executable(test-cntr${suffix} test-cntr.cpp)
    target_include_directories(test-cntr${suffix} PUBLIC include)
    target_link_libraries(test-cntr${suffix} psibase-contract-simple-malloc)
    set_target_properties(test-cntr${suffix} PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${ROOT_BINARY_DIR})

    add_executable(boot${suffix} boot.cpp)
    target_include_directories(boot${suffix} PUBLIC include)
    target_link_libraries(boot${suffix} psibase-contract-simple-malloc)
    set_target_properties(boot${suffix} PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${ROOT_BINARY_DIR})

    add_executable(token${suffix} token.cpp)
    target_include_directories(token${suffix} PUBLIC include)
    target_link_libraries(token${suffix} psibase-contract-simple-malloc)
    set_target_properties(token${suffix} PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${ROOT_BINARY_DIR})

    add_executable(rpc${suffix} rpc.cpp)
    target_include_directories(rpc${suffix} PUBLIC include)
    target_link_libraries(rpc${suffix} psibase-contract-simple-malloc)
    set_target_properties(rpc${suffix} PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${ROOT_BINARY_DIR})

    add_executable(account${suffix} account.cpp)
    target_include_directories(account${suffix} PUBLIC include)
    target_link_libraries(account${suffix} psibase-contract-simple-malloc)
    set_target_properties(account${suffix} PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${ROOT_BINARY_DIR})

    add_executable(tests${suffix} test.cpp)
    target_include_directories(tests${suffix} PUBLIC include)
    target_link_libraries(tests${suffix} nctestlib)
    set_target_properties(tests${suffix} PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${ROOT_BINARY_DIR})
endfunction(add)

add("")
add("-debug")
