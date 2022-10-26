function(add suffix)
    add_system_service("${suffix}" PsiSpaceSys src/PsiSpaceSys.cpp)
endfunction(add)

conditional_add()

set(CMAKE_EXPORT_COMPILE_COMMANDS on)
