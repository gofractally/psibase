function(add suffix)
    add_system_service("${suffix}" Transact src/Transact.cpp)
    add_system_service("${suffix}" RTransact src/RTransact.cpp)
endfunction(add)

conditional_add()

add_subdirectory(test)
