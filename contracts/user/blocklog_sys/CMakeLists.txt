function(add suffix)
    add_system_contract("${suffix}" blocklog_sys src/blocklog_sys.cpp)
endfunction(add)

add("")
add("-debug")
