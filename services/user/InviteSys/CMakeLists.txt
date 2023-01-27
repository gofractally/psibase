function(add suffix)
    add_user_service("${suffix}" InviteSys src/InviteSys.cpp)
    add_user_service("${suffix}" AuthInviteSys src/AuthInviteSys.cpp)
endfunction(add)

conditional_add()

add_subdirectory(test)

set(CMAKE_EXPORT_COMPILE_COMMANDS on)
