function(add suffix)
    add_system_service("${suffix}" Transact src/Transact.cpp)
    add_system_service_full_malloc("${suffix}" RTransact src/RTransact.cpp)
    target_link_libraries(RTransact${suffix} PRIVATE services_user${suffix})
endfunction(add)

conditional_add()

add_subdirectory(test)
