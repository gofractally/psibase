add_executable(name name.cpp)
target_link_libraries(name abieos)
set_target_properties(name PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${ROOT_BINARY_DIR})

add_custom_command(TARGET name POST_BUILD
    COMMAND ln -sf name ${ROOT_BINARY_DIR}/name2num
    COMMAND ln -sf name ${ROOT_BINARY_DIR}/num2name
)

add_executable(sort-abi sort-abi.cpp)
target_link_libraries(sort-abi abieos)
