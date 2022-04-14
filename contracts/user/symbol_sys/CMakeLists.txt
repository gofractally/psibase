function(add suffix)
    add_user_contract("${suffix}" symbol_sys contract/src/symbol_sys.cpp)
endfunction(add)

add("")
add("-debug")

add_subdirectory(contract/test)

set(CMAKE_EXPORT_COMPILE_COMMANDS on)