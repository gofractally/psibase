function(add suffix)
    add_user_contract("${suffix}" tokens_sys contract/src/tokens_sys.cpp)
endfunction(add)

add("")
add("-debug")

#add_subdirectory(contract/test)

set(CMAKE_EXPORT_COMPILE_COMMANDS on)
