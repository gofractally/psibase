function(add suffix)
    add_user_service("${suffix}" Invite src/Invite.cpp)
    add_user_service("${suffix}" RInvite src/RInvite.cpp)

    target_link_libraries(Invite${suffix} PUBLIC Spki${suffix})
    target_link_libraries(RInvite${suffix} PUBLIC Spki${suffix})
endfunction(add)

conditional_add()

add_subdirectory(test)

set(CMAKE_EXPORT_COMPILE_COMMANDS on)
