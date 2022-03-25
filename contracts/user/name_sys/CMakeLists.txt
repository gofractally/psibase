function(add suffix)
    add_user_contract("${suffix}" name_sys contract/src/name_sys.cpp)
endfunction(add)

add("")
add("-debug")

add_subdirectory(contract/test)

set(CMAKE_EXPORT_COMPILE_COMMANDS on)