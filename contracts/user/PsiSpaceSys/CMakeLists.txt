function(add suffix)
    add_system_contract("${suffix}" PsiSpaceSys src/PsiSpaceSys.cpp)
endfunction(add)

conditional_add()
