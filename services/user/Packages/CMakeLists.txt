function(add suffix)
    add_user_service("${suffix}" Packages src/Packages.cpp)
    add_user_service("${suffix}" RPackages src/RPackages.cpp)
endfunction(add)

conditional_add()
