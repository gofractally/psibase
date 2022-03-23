function(add suffix)
    add_system_contract("${suffix}" transaction_sys src/transaction_sys.cpp)
endfunction(add)

add("")
add("-debug")
