function(add suffix)
    add_user_service("${suffix}" Email src/Email.cpp)
endfunction(add)

conditional_add()

set(CMAKE_EXPORT_COMPILE_COMMANDS on)