function(add suffix)
    add_user_service("${suffix}" PackageSys src/PackageSys.cpp)
    add_user_service("${suffix}" RPackageSys src/RPackageSys.cpp)
endfunction(add)

conditional_add()
