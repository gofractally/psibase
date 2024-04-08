function(add suffix)
    add_user_service("${suffix}" Invite src/Invite.cpp)
    add_user_service("${suffix}" AuthInvite src/AuthInvite.cpp)
endfunction(add)

conditional_add()

add_subdirectory(test)

set(CMAKE_EXPORT_COMPILE_COMMANDS on)
