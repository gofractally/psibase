function(add suffix)
    add_system_service("${suffix}" Db src/Db.cpp)
endfunction(add)

conditional_add()
