function(add suffix)
    add_system_contract("${suffix}" ExploreSys src/ExploreSys.cpp)
endfunction(add)

conditional_add()
