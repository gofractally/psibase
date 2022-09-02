function(add suffix)
    add_user_service("${suffix}" ExploreSys src/ExploreSys.cpp)
endfunction(add)

conditional_add()
