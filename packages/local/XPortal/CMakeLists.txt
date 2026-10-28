function(add suffix)
    add_local_service("${suffix}" XPortal src/XPortal.cpp src/XPortalSignup.cpp src/XPortalAgents.cpp)
    target_link_libraries(XPortal${suffix} PUBLIC Spki${suffix})
endfunction(add)

conditional_add()

add_subdirectory(test)

install(DIRECTORY include/ TYPE INCLUDE FILES_MATCHING PATTERN "*.hpp")

set(CMAKE_EXPORT_COMPILE_COMMANDS on)
