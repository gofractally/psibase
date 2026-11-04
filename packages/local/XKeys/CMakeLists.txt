function(add suffix)
    add_local_service("${suffix}" XKeys src/XKeys.cpp)
    target_link_libraries(XKeys${suffix} PUBLIC PrivateKeyInfo${suffix} Spki${suffix})
endfunction(add)

conditional_add()

add_subdirectory(test)

install(DIRECTORY include/ TYPE INCLUDE FILES_MATCHING PATTERN "*.hpp")

set(CMAKE_EXPORT_COMPILE_COMMANDS on)
