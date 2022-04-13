function(add suffix)
    add_user_contract("${suffix}" exchange_sys src/exchange_sys.cpp)
endfunction(add)

add("")
add("-debug")

add_subdirectory(test)

set(CMAKE_EXPORT_COMPILE_COMMANDS on)