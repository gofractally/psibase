enable_testing()

add_subdirectory(clio)

if(NOT CLIO_ONLY)
    add_subdirectory(abieos)
    add_subdirectory(psibase)

    if(DEFINED IS_WASM)
        add_subdirectory(eosiolib)
    endif()

    if(DEFINED IS_NATIVE)
        add_subdirectory(debug_eos_vm)
        add_subdirectory(psibase_http)
    endif()
endif()
