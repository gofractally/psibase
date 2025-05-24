function(add suffix)
    add_system_service_full_malloc("${suffix}" Transact src/Transact.cpp)
    add_system_service_full_malloc("${suffix}" RTransact src/RTransact.cpp)
endfunction(add)

conditional_add()

add_subdirectory(test)
