function(add suffix)
    add_local_service("${suffix}" XBasic src/XBasic.cpp)
    target_include_directories(XBasic${suffix} PUBLIC ${ROOT_BINARY_DIR}/wasm/deps/include/botan-3)
    target_link_libraries(XBasic${suffix} PUBLIC -lbotan-3 exception-stub${suffix})
endfunction(add)

conditional_add()

add_subdirectory(test)

install(DIRECTORY include/ TYPE INCLUDE FILES_MATCHING PATTERN "*.hpp")

set(CMAKE_EXPORT_COMPILE_COMMANDS on)
