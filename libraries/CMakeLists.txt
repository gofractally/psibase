enable_testing()
add_subdirectory(abieos)
add_subdirectory(newchain)

if(DEFINED IS_WASM)
    add_subdirectory(eosiolib)
endif()

if(DEFINED IS_NATIVE)
    add_subdirectory(debug_eos_vm)
endif()
