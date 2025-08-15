function(add suffix)
    add_user_service("${suffix}" XAdmin query/src/XAdmin.cpp)
    target_link_libraries(XAdmin${suffix} PRIVATE services_local)
endfunction(add)

conditional_add()

set(CMAKE_EXPORT_COMPILE_COMMANDS on)
