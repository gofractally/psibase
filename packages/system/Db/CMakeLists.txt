function(add suffix)
    add_system_service("${suffix}" Db src/Db.cpp)
    target_link_libraries(Db${suffix} PUBLIC services_user)
endfunction(add)

conditional_add()
