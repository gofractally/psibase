function(add suffix)
    add_executable(nc-test-cntr${suffix} nc-test-cntr.cpp)
    target_include_directories(nc-test-cntr${suffix} PUBLIC include)
    target_link_libraries(nc-test-cntr${suffix} newchain-contract-simple-malloc)
    set_target_properties(nc-test-cntr${suffix} PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${ROOT_BINARY_DIR})

    add_executable(nc-boot${suffix} nc-boot.cpp)
    target_include_directories(nc-boot${suffix} PUBLIC include)
    target_link_libraries(nc-boot${suffix} newchain-contract-simple-malloc)
    set_target_properties(nc-boot${suffix} PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${ROOT_BINARY_DIR})

    add_executable(nc-token${suffix} nc-token.cpp)
    target_include_directories(nc-token${suffix} PUBLIC include)
    target_link_libraries(nc-token${suffix} newchain-contract-simple-malloc)
    set_target_properties(nc-token${suffix} PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${ROOT_BINARY_DIR})

    add_executable(nc-test${suffix} nc-test.cpp)
    target_include_directories(nc-test${suffix} PUBLIC include)
    target_link_libraries(nc-test${suffix} nctestlib)
    set_target_properties(nc-test${suffix} PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${ROOT_BINARY_DIR})
endfunction(add)

add("")
add("-debug")
