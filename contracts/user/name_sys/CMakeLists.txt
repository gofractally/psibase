function(add suffix)
    add_user_contract("${suffix}" name_sys src/name_sys.cpp)
endfunction(add)

add("")
add("-debug")

add_subdirectory(test)

set(CMAKE_EXPORT_COMPILE_COMMANDS on)