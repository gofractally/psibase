function(add suffix)
    add_local_service("${suffix}" XKeys src/XKeys.cpp)
    target_link_libraries(XKeys${suffix} PUBLIC PrivateKeyInfo${suffix})
endfunction(add)

conditional_add()

install(DIRECTORY include/ TYPE INCLUDE FILES_MATCHING PATTERN "*.hpp")

set(CMAKE_EXPORT_COMPILE_COMMANDS on)
