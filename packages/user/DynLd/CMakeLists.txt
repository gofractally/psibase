function(add suffix)
    add_user_service("${suffix}" DynLd src/DynLd.cpp)
    add_user_service("${suffix}" RDynLd src/RDynLd.cpp)
endfunction(add)

conditional_add()

install(DIRECTORY include/ TYPE INCLUDE FILES_MATCHING PATTERN "*.hpp")
