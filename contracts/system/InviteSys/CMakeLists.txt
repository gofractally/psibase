function(add suffix)
    add_system_contract("${suffix}" InviteSys src/InviteSys.cpp)
    # add_system_contract("${suffix}" RAccountSys src/RAccountSys.cpp)
endfunction(add)

conditional_add()
